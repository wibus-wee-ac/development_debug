//! macOS native capture source for Cradle Chronicle.

#[cfg(target_os = "macos")]
mod native {
    use std::collections::VecDeque;
    use std::ffi::c_void;
    use std::ptr;

    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use core_graphics::display::CGDisplay;
    use core_graphics::image::CGImage;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        kCGWindowName, kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
    };
    use foreign_types::ForeignType;

    // Link frameworks needed for FFI calls
    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}
    #[link(name = "Vision", kind = "framework")]
    unsafe extern "C" {}

    use crate::error::{ChronicleError, ChronicleResult};
    use crate::screen::privacy_filter::PrivacyFilter;
    use crate::screen::{BrowserWindowObservation, CaptureSource, CapturedFrame};
    use crate::time::Timestamp;

    pub struct MacosCaptureSource {
        frames: VecDeque<CapturedFrame>,
    }

    impl MacosCaptureSource {
        pub fn capture_all(frame_index: u64) -> ChronicleResult<Self> {
            let display_ids = active_display_ids()?;
            Self::capture_displays(&display_ids, frame_index)
        }

        pub fn capture(display_id: u32, frame_index: u64) -> ChronicleResult<Self> {
            Self::capture_displays(&[display_id], frame_index)
        }

        fn capture_displays(display_ids: &[u32], frame_index: u64) -> ChronicleResult<Self> {
            let windows = read_window_inventory()?;
            if PrivacyFilter.should_exclude_windows(&windows) {
                return Ok(Self {
                    frames: VecDeque::new(),
                });
            }
            if display_ids.is_empty() {
                return Err(ChronicleError::Process(
                    "macOS active display list is empty".to_string(),
                ));
            }

            let captured_at = Timestamp::now()?;
            let mut frames = VecDeque::with_capacity(display_ids.len());
            for display_id in display_ids {
                let cg_image = capture_display(*display_id)?;
                let bytes = encode_cgimage_to_png(&cg_image)?;
                if bytes.is_empty() {
                    return Err(ChronicleError::Process(format!(
                        "macOS display capture produced empty image data for display {display_id}"
                    )));
                }
                let observed_text = run_vision_ocr(&cg_image)?;

                frames.push_back(CapturedFrame {
                    display_id: *display_id,
                    frame_index,
                    captured_at,
                    bytes,
                    frame_extension: "png".to_string(),
                    observed_text,
                    windows: windows.clone(),
                });
            }

            Ok(Self { frames })
        }
    }

    impl CaptureSource for MacosCaptureSource {
        fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
            Ok(self.frames.pop_front())
        }
    }

    // --- Screen Capture via CGDisplay ---

    fn active_display_ids() -> ChronicleResult<Vec<u32>> {
        CGDisplay::active_displays().map_err(|error| {
            ChronicleError::Process(format!(
                "failed to enumerate active macOS displays: {error:?}"
            ))
        })
    }

    fn capture_display(display_id: u32) -> ChronicleResult<CGImage> {
        let display = if display_id == 0 {
            CGDisplay::main()
        } else {
            CGDisplay::new(display_id)
        };

        display.image().ok_or_else(|| {
            ChronicleError::Process(
                "CGDisplayCreateImage returned null. Grant Screen Recording permission."
                    .to_string(),
            )
        })
    }

    fn encode_cgimage_to_png(image: &CGImage) -> ChronicleResult<Vec<u8>> {
        // Use ImageIO to write CGImage to PNG data in-memory.
        #[link(name = "ImageIO", kind = "framework")]
        unsafe extern "C" {
            fn CGImageDestinationCreateWithData(
                data: CFTypeRef,
                type_: CFTypeRef,
                count: usize,
                options: CFTypeRef,
            ) -> *mut c_void;
            fn CGImageDestinationAddImage(
                dest: *mut c_void,
                image: *const c_void,
                properties: CFTypeRef,
            );
            fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
        }

        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            fn CFDataCreateMutable(allocator: CFTypeRef, capacity: isize) -> CFTypeRef;
            fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
            fn CFDataGetLength(data: CFTypeRef) -> isize;
        }

        unsafe {
            let mutable_data = CFDataCreateMutable(ptr::null(), 0);
            if mutable_data.is_null() {
                return Err(ChronicleError::Process(
                    "failed to create mutable data for PNG encoding".to_string(),
                ));
            }

            let png_uti = CFString::new("public.png");
            let dest = CGImageDestinationCreateWithData(
                mutable_data,
                png_uti.as_CFTypeRef(),
                1,
                ptr::null(),
            );
            if dest.is_null() {
                CFRelease(mutable_data);
                return Err(ChronicleError::Process(
                    "failed to create CGImageDestination for PNG".to_string(),
                ));
            }

            CGImageDestinationAddImage(dest, image.as_ptr() as *const c_void, ptr::null());

            let success = CGImageDestinationFinalize(dest);
            CFRelease(dest as CFTypeRef);

            if !success {
                CFRelease(mutable_data);
                return Err(ChronicleError::Process(
                    "CGImageDestinationFinalize failed".to_string(),
                ));
            }

            let ptr = CFDataGetBytePtr(mutable_data);
            let len = CFDataGetLength(mutable_data) as usize;
            let bytes = std::slice::from_raw_parts(ptr, len).to_vec();
            CFRelease(mutable_data);

            Ok(bytes)
        }
    }

    // --- Window Enumeration via CoreGraphics ---

    fn read_window_inventory() -> ChronicleResult<Vec<BrowserWindowObservation>> {
        use core_foundation::array::CFArray;
        use core_foundation::dictionary::CFDictionary;

        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_list: CFArray<CFDictionary<CFString, CFTypeRef>> = unsafe {
            let raw = core_graphics::window::CGWindowListCopyWindowInfo(options, kCGNullWindowID);
            if raw.is_null() {
                return Ok(Vec::new());
            }
            CFArray::wrap_under_create_rule(raw as *mut _)
        };

        // Build PID -> bundle ID map via NSWorkspace
        let pid_to_bundle = build_pid_to_bundle_map();

        let key_number = unsafe { CFString::wrap_under_get_rule(kCGWindowNumber) };
        let key_pid = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerPID) };
        let key_name = unsafe { CFString::wrap_under_get_rule(kCGWindowName) };
        let key_owner = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerName) };

        let mut windows = Vec::new();
        for i in 0..window_list.len() {
            let dict = unsafe { window_list.get_unchecked(i) };

            let window_id = get_dict_number(&dict, &key_number).unwrap_or(0) as u32;
            let pid = get_dict_number(&dict, &key_pid).unwrap_or(0) as i32;
            let title = get_dict_string(&dict, &key_name).unwrap_or_default();
            let owner_name = get_dict_string(&dict, &key_owner).unwrap_or_default();

            let bundle_id = pid_to_bundle.get(&pid).cloned().unwrap_or(owner_name);

            windows.push(BrowserWindowObservation::new(window_id, title, bundle_id));
        }

        Ok(windows)
    }

    fn get_dict_number(
        dict: &core_foundation::dictionary::CFDictionary<CFString, CFTypeRef>,
        key: &CFString,
    ) -> Option<i64> {
        use core_foundation::number::CFNumber;
        unsafe {
            if dict.contains_key(key) {
                let value = dict.get(key);
                let number: CFNumber = CFNumber::wrap_under_get_rule(*value as *const _);
                number.to_i64()
            } else {
                None
            }
        }
    }

    fn get_dict_string(
        dict: &core_foundation::dictionary::CFDictionary<CFString, CFTypeRef>,
        key: &CFString,
    ) -> Option<String> {
        unsafe {
            if dict.contains_key(key) {
                let value = dict.get(key);
                let cf_str = CFString::wrap_under_get_rule(*value as *const _);
                Some(cf_str.to_string())
            } else {
                None
            }
        }
    }

    fn build_pid_to_bundle_map() -> std::collections::HashMap<i32, String> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::AnyObject;

        autoreleasepool(|_| {
            let mut map = std::collections::HashMap::new();

            unsafe {
                // [NSWorkspace sharedWorkspace]
                let cls = objc2::runtime::AnyClass::get(c"NSWorkspace").unwrap();
                let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
                if workspace.is_null() {
                    return map;
                }
                // [workspace runningApplications]
                let apps: *mut AnyObject = msg_send![workspace, runningApplications];
                if apps.is_null() {
                    return map;
                }
                let count: usize = msg_send![apps, count];
                for i in 0..count {
                    let app: *mut AnyObject = msg_send![apps, objectAtIndex: i];
                    if app.is_null() {
                        continue;
                    }
                    let pid: i32 = msg_send![app, processIdentifier];
                    let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
                    if !bundle_id.is_null() {
                        let utf8: *const u8 = msg_send![bundle_id, UTF8String];
                        if !utf8.is_null() {
                            let cstr = std::ffi::CStr::from_ptr(utf8 as *const _);
                            if let Ok(s) = cstr.to_str() {
                                map.insert(pid, s.to_string());
                            }
                        }
                    }
                }
            }

            map
        })
    }

    // --- Vision OCR via objc2 ---

    fn run_vision_ocr(cg_image: &CGImage) -> ChronicleResult<String> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::AnyObject;

        autoreleasepool(|_| {
            unsafe {
                // Create VNRecognizeTextRequest
                let request_cls = objc2::runtime::AnyClass::get(c"VNRecognizeTextRequest")
                    .ok_or_else(|| {
                        ChronicleError::Process(
                            "VNRecognizeTextRequest class not found (requires macOS 10.15+)"
                                .to_string(),
                        )
                    })?;
                let request: *mut AnyObject = msg_send![request_cls, alloc];
                let request: *mut AnyObject = msg_send![request, init];
                if request.is_null() {
                    return Err(ChronicleError::Process(
                        "failed to create VNRecognizeTextRequest".to_string(),
                    ));
                }

                // Set recognition level to accurate (1)
                let _: () = msg_send![request, setRecognitionLevel: 1i64];
                // Enable language correction for better accuracy
                let _: () = msg_send![request, setUsesLanguageCorrection: true];
                // Use revision 3 (macOS 13+) for best quality; falls back gracefully
                let _: () = msg_send![request, setRevision: 3usize];
                // Set recognition languages — prioritize English + Chinese + Japanese
                let nsstring_cls = objc2::runtime::AnyClass::get(c"NSString").unwrap();
                let array_cls = objc2::runtime::AnyClass::get(c"NSArray").unwrap();
                let lang_en: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"en-US".as_ptr()];
                let lang_zh: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"zh-Hans".as_ptr()];
                let lang_ja: *mut AnyObject =
                    msg_send![nsstring_cls, stringWithUTF8String: c"ja".as_ptr()];
                let langs_raw: [*mut AnyObject; 3] = [lang_en, lang_zh, lang_ja];
                let lang_array: *mut AnyObject =
                    msg_send![array_cls, arrayWithObjects: langs_raw.as_ptr(), count: 3usize];
                let _: () = msg_send![request, setRecognitionLanguages: lang_array];
                // Minimum text height filter (ignore very tiny text that's usually noise)
                let _: () = msg_send![request, setMinimumTextHeight: 0.01f32];

                // Create VNImageRequestHandler with CGImage
                let handler_cls = objc2::runtime::AnyClass::get(c"VNImageRequestHandler")
                    .ok_or_else(|| {
                        // Release request before returning error
                        let _: () = msg_send![request, release];
                        ChronicleError::Process(
                            "VNImageRequestHandler class not found (requires macOS 10.15+)"
                                .to_string(),
                        )
                    })?;
                let handler: *mut AnyObject = msg_send![handler_cls, alloc];
                // initWithCGImage:options: — use raw objc_msgSend because
                // core_graphics::CGImage doesn't implement objc2::RefEncode
                let cg_image_ptr: *const c_void = cg_image.as_ptr().cast();
                let empty_dict_cls = objc2::runtime::AnyClass::get(c"NSDictionary").unwrap();
                let empty_dict: *mut AnyObject = msg_send![empty_dict_cls, dictionary];
                let sel = objc2::sel!(initWithCGImage:options:);
                let init_fn: unsafe extern "C" fn(
                    *mut AnyObject,
                    objc2::runtime::Sel,
                    *const c_void,
                    *mut AnyObject,
                ) -> *mut AnyObject = std::mem::transmute(objc2::ffi::objc_msgSend as *const ());
                let handler: *mut AnyObject = init_fn(handler, sel, cg_image_ptr, empty_dict);
                if handler.is_null() {
                    let _: () = msg_send![request, release];
                    return Err(ChronicleError::Process(
                        "failed to create VNImageRequestHandler".to_string(),
                    ));
                }

                // Create NSArray with single request
                let array_cls = objc2::runtime::AnyClass::get(c"NSArray").unwrap();
                let requests: *mut AnyObject = msg_send![array_cls, arrayWithObject: request];

                // performRequests:error:
                let mut error: *mut AnyObject = ptr::null_mut();
                let success: bool =
                    msg_send![handler, performRequests: requests, error: &mut error];

                if !success {
                    let desc = if !error.is_null() {
                        let desc: *mut AnyObject = msg_send![error, localizedDescription];
                        if !desc.is_null() {
                            let utf8: *const u8 = msg_send![desc, UTF8String];
                            if !utf8.is_null() {
                                std::ffi::CStr::from_ptr(utf8 as *const _)
                                    .to_string_lossy()
                                    .to_string()
                            } else {
                                "unknown error".to_string()
                            }
                        } else {
                            "unknown error".to_string()
                        }
                    } else {
                        "unknown error".to_string()
                    };
                    let _: () = msg_send![request, release];
                    let _: () = msg_send![handler, release];
                    return Err(ChronicleError::Process(format!(
                        "Vision OCR failed: {desc}"
                    )));
                }

                // Extract results
                let results: *mut AnyObject = msg_send![request, results];
                let text = if results.is_null() {
                    String::new()
                } else {
                    let count: usize = msg_send![results, count];
                    let mut lines = Vec::with_capacity(count);
                    for i in 0..count {
                        let observation: *mut AnyObject = msg_send![results, objectAtIndex: i];
                        if observation.is_null() {
                            continue;
                        }
                        // Skip low-confidence observations (< 0.3)
                        let confidence: f32 = msg_send![observation, confidence];
                        if confidence < 0.3 {
                            continue;
                        }
                        // topCandidates:1
                        let candidates: *mut AnyObject =
                            msg_send![observation, topCandidates: 1usize];
                        if candidates.is_null() {
                            continue;
                        }
                        let cand_count: usize = msg_send![candidates, count];
                        if cand_count == 0 {
                            continue;
                        }
                        let candidate: *mut AnyObject =
                            msg_send![candidates, objectAtIndex: 0usize];
                        if candidate.is_null() {
                            continue;
                        }
                        let string: *mut AnyObject = msg_send![candidate, string];
                        if string.is_null() {
                            continue;
                        }
                        let utf8: *const u8 = msg_send![string, UTF8String];
                        if !utf8.is_null() {
                            let cstr = std::ffi::CStr::from_ptr(utf8 as *const _);
                            if let Ok(s) = cstr.to_str() {
                                lines.push(s.to_string());
                            }
                        }
                    }
                    lines.join("\n")
                };

                // Release owned objects
                let _: () = msg_send![request, release];
                let _: () = msg_send![handler, release];

                Ok(text)
            }
        })
    }
}

#[cfg(target_os = "macos")]
pub use native::MacosCaptureSource;

#[cfg(not(target_os = "macos"))]
mod stub {
    use crate::error::{ChronicleError, ChronicleResult};
    use crate::screen::{CaptureSource, CapturedFrame};

    pub struct MacosCaptureSource;

    impl MacosCaptureSource {
        pub fn capture_all(_frame_index: u64) -> ChronicleResult<Self> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }

        pub fn capture(_display_id: u32, _frame_index: u64) -> ChronicleResult<Self> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }
    }

    impl CaptureSource for MacosCaptureSource {
        fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
            Err(ChronicleError::Process(
                "macOS capture is only available on macOS".to_string(),
            ))
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::MacosCaptureSource;
