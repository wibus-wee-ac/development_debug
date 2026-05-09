// Input: HttpContext values
// Output: requestId type augmentation
// Position: server request context

export const REQUEST_ID_HEADER = 'x-request-id'

declare module '@tsuki-hono/common' {
  interface HttpContextValues {
    requestId?: string
  }
}
