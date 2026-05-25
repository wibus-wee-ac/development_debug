// Bridges Cradle to the private Codex Computer Use Appshot Apple Event protocol.
import AppKit
import CryptoKit
import Foundation

private let codexComputerUseBundleIdentifier = "com.openai.sky.CUAService"
private let codexComputerUseClientApiVersion = "CodexComputerUseNativeBridge-1"
private let codexAppleEventClass = fourCharCode("SkCu")
private let codexAppleEventIdentifier = fourCharCode("SndR")
private let codexRequestTypeKeyword = fourCharCode("RspT")
private let codexRequestDataKeyword = fourCharCode("ReqD")
private let codexClientVersionKeyword = fourCharCode("ClVn")
private let codexErrorNumberKeyword = fourCharCode("errn")
private let codexErrorStringKeyword = fourCharCode("errs")
private let codexRequestDataType = fourCharCode("tdta")
private let codexUtf8TextType = fourCharCode("utf8")

final class CodexAppshotPrivateAdapter: @unchecked Sendable {
    func readService() -> [String: Any] {
        let processIdentifier = readServiceProcessIdentifier()
        return [
            "bundleIdentifier": codexComputerUseBundleIdentifier,
            "processIdentifier": processIdentifier.map { Int($0) } ?? NSNull(),
            "running": processIdentifier != nil,
        ]
    }

    func startCapture(params: [String: Any]) throws -> [String: Any] {
        guard let requestId = params["requestId"] as? String, !requestId.isEmpty,
              let bundleIdentifier = params["bundleIdentifier"] as? String, !bundleIdentifier.isEmpty,
              let animationTarget = params["animationTarget"] as? [String: Any]
        else {
            throw BridgeError("invalid-params", "mac.codexAppshot.startCapture requires requestId, bundleIdentifier, and animationTarget.")
        }

        let request: [String: Any] = [
            "requestId": requestId,
            "app": bundleIdentifier,
            "animationTarget": animationTarget,
        ]
        return try sendCodexRequest(
            requestType: "ComputerUseIPCAppStartCaptureRequest",
            request: request,
            serviceProcessIdentifier: try readServiceProcessIdentifier(params: params),
            timeoutSeconds: try readTimeoutSeconds(params: params, defaultValue: 115)
        )
    }

    func nextCaptureUpdate(params: [String: Any]) throws -> [String: Any] {
        guard let requestId = params["requestId"] as? String, !requestId.isEmpty else {
            throw BridgeError("invalid-params", "mac.codexAppshot.nextCaptureUpdate requires requestId.")
        }

        return try sendCodexRequest(
            requestType: "ComputerUseIPCAppNextCaptureUpdateRequest",
            request: ["requestId": requestId],
            serviceProcessIdentifier: try readServiceProcessIdentifier(params: params),
            timeoutSeconds: try readTimeoutSeconds(params: params, defaultValue: 125)
        )
    }

    private func readServiceProcessIdentifier(params: [String: Any]) throws -> pid_t {
        if let raw = params["serviceProcessIdentifier"] as? NSNumber {
            let processIdentifier = raw.int32Value
            if processIdentifier > 0 {
                return processIdentifier
            }
        }
        if let processIdentifier = readServiceProcessIdentifier() {
            return processIdentifier
        }
        throw BridgeError("codex-appshot-service-unavailable", "Codex Computer Use service is not running.", details: [
            "bundleIdentifier": codexComputerUseBundleIdentifier,
        ])
    }

    private func readServiceProcessIdentifier() -> pid_t? {
        NSRunningApplication
            .runningApplications(withBundleIdentifier: codexComputerUseBundleIdentifier)
            .first { !$0.isTerminated }
            .map(\.processIdentifier)
    }

    private func readTimeoutSeconds(params: [String: Any], defaultValue: Int) throws -> Int {
        guard let raw = params["timeoutSeconds"] as? NSNumber else {
            return defaultValue
        }
        let timeoutSeconds = raw.intValue
        guard timeoutSeconds > 0 && timeoutSeconds <= 300 else {
            throw BridgeError("invalid-params", "Codex Appshot Apple Event timeout must be between 1 and 300 seconds.", details: [
                "timeoutSeconds": String(timeoutSeconds),
            ])
        }
        return timeoutSeconds
    }

    private func sendCodexRequest(
        requestType: String,
        request: [String: Any],
        serviceProcessIdentifier: pid_t,
        timeoutSeconds: Int
    ) throws -> [String: Any] {
        let requestData = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
        let sentAt = isoTimestamp()
        let requestEnvelope: [String: Any] = [
            "eventClass": "SkCu",
            "eventIdentifier": "SndR",
            "requestTypeKeyword": "RspT",
            "requestDataKeyword": "ReqD",
            "clientVersionKeyword": "ClVn",
            "requestDataDescriptorType": "tdta",
            "textDescriptorType": "utf8",
            "requestType": requestType,
            "clientVersion": codexComputerUseClientApiVersion,
            "requestSha256": sha256Hex(requestData),
            "requestByteCount": requestData.count,
            "request": request,
        ]
        let target = NSAppleEventDescriptor(processIdentifier: serviceProcessIdentifier)
        let event = NSAppleEventDescriptor(
            eventClass: AEEventClass(codexAppleEventClass),
            eventID: AEEventID(codexAppleEventIdentifier),
            targetDescriptor: target,
            returnID: AEReturnID(kAutoGenerateReturnID),
            transactionID: AETransactionID(kAnyTransactionID)
        )

        event.setParam(try utf8Descriptor(requestType), forKeyword: AEKeyword(codexRequestTypeKeyword))
        event.setParam(try utf8Descriptor(codexComputerUseClientApiVersion), forKeyword: AEKeyword(codexClientVersionKeyword))
        event.setParam(try jsonDescriptor(data: requestData), forKeyword: AEKeyword(codexRequestDataKeyword))

        let reply: NSAppleEventDescriptor
        do {
            reply = try event.sendEvent(
                options: NSAppleEventDescriptor.SendOptions.waitForReply,
                timeout: TimeInterval(timeoutSeconds)
            )
        } catch {
            let nsError = error as NSError
            throw BridgeError("codex-appshot-apple-event-send-failed", "Codex Computer Use Apple Event did not return a reply.", details: [
                "requestType": requestType,
                "serviceProcessIdentifier": String(serviceProcessIdentifier),
                "timeoutSeconds": String(timeoutSeconds),
                "domain": nsError.domain,
                "code": String(nsError.code),
                "localizedDescription": nsError.localizedDescription,
                "bundleIdentifier": codexComputerUseBundleIdentifier,
                "clientVersion": codexComputerUseClientApiVersion,
                "transcript": encodeJsonString([
                    "status": "send-failed",
                    "sentAt": sentAt,
                    "failedAt": isoTimestamp(),
                    "request": requestEnvelope,
                    "target": [
                        "bundleIdentifier": codexComputerUseBundleIdentifier,
                        "serviceProcessIdentifier": Int(serviceProcessIdentifier),
                    ],
                    "error": [
                        "domain": nsError.domain,
                        "code": nsError.code,
                        "localizedDescription": nsError.localizedDescription,
                    ],
                ]),
            ])
        }

        if let errorNumberDescriptor = reply.paramDescriptor(forKeyword: AEKeyword(codexErrorNumberKeyword)) {
            let errorNumber = errorNumberDescriptor.int32Value
            let message = reply.paramDescriptor(forKeyword: AEKeyword(codexErrorStringKeyword))?.stringValue
                ?? "Codex Computer Use Apple Event failed."
            throw BridgeError("codex-appshot-apple-event-error", message, details: [
                "errorNumber": String(errorNumber),
                "requestType": requestType,
                "transcript": encodeJsonString([
                    "status": "reply-error",
                    "sentAt": sentAt,
                    "receivedAt": isoTimestamp(),
                    "request": requestEnvelope,
                    "reply": [
                        "errorNumber": Int(errorNumber),
                        "errorString": message,
                    ],
                ]),
            ])
        }

        guard let responseDescriptor = reply.paramDescriptor(forKeyword: keyDirectObject),
              let response = try JSONSerialization.jsonObject(with: responseDescriptor.data) as? [String: Any]
        else {
            throw BridgeError("codex-appshot-invalid-response", "Codex Computer Use reply did not include JSON response data.", details: [
                "requestType": requestType,
                "transcript": encodeJsonString([
                    "status": "invalid-response",
                    "sentAt": sentAt,
                    "receivedAt": isoTimestamp(),
                    "request": requestEnvelope,
                    "reply": [
                        "directObjectDescriptorType": fourCharString(reply.paramDescriptor(forKeyword: keyDirectObject)?.descriptorType),
                    ],
                ]),
            ])
        }
        let responseData = responseDescriptor.data
        var payload = response
        payload["cradleTranscript"] = [
            "status": "succeeded",
            "sentAt": sentAt,
            "receivedAt": isoTimestamp(),
            "target": [
                "bundleIdentifier": codexComputerUseBundleIdentifier,
                "serviceProcessIdentifier": Int(serviceProcessIdentifier),
            ],
            "request": requestEnvelope,
            "reply": [
                "directObjectDescriptorType": fourCharString(responseDescriptor.descriptorType),
                "responseSha256": sha256Hex(responseData),
                "responseByteCount": responseData.count,
                "response": response,
            ],
        ]
        return payload
    }
}

private func jsonDescriptor(data: Data) throws -> NSAppleEventDescriptor {
    guard let descriptor = NSAppleEventDescriptor(descriptorType: DescType(codexRequestDataType), data: data) else {
        throw BridgeError("codex-appshot-descriptor-failed", "Could not create Codex Apple Event JSON descriptor.")
    }
    return descriptor
}

private func utf8Descriptor(_ value: String) throws -> NSAppleEventDescriptor {
    guard let data = value.data(using: .utf8) else {
        throw BridgeError("codex-appshot-encoding-failed", "Could not encode Codex Apple Event text as UTF-8.")
    }
    guard let descriptor = NSAppleEventDescriptor(descriptorType: DescType(codexUtf8TextType), data: data) else {
        throw BridgeError("codex-appshot-descriptor-failed", "Could not create Codex Apple Event text descriptor.")
    }
    return descriptor
}

func fourCharCode(_ value: String) -> UInt32 {
    precondition(value.utf8.count == 4, "Four-character code must contain exactly four UTF-8 bytes.")
    return value.utf8.reduce(UInt32(0)) { partial, byte in
        (partial << 8) + UInt32(byte)
    }
}

private func fourCharString(_ value: DescType?) -> String {
    guard let value else {
        return "null"
    }
    let bytes = [
        UInt8((value >> 24) & 0xff),
        UInt8((value >> 16) & 0xff),
        UInt8((value >> 8) & 0xff),
        UInt8(value & 0xff),
    ]
    return String(bytes: bytes, encoding: .macOSRoman) ?? String(value)
}

private func sha256Hex(_ data: Data) -> String {
    let digest = SHA256.hash(data: data)
    return digest.map { String(format: "%02x", $0) }.joined()
}

private func encodeJsonString(_ object: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
          let value = String(data: data, encoding: .utf8)
    else {
        return "{}"
    }
    return value
}
