import { CapacitorHttp } from '@capacitor/core'
import { startBackgroundGeneration, stopBackgroundGeneration } from '@/native/background-generation'
import { createNativeReadableStream } from '@/native/stream-http'
import { settingsStore } from '@/stores/settingsStore'
import { ApiError } from '../../shared/models/errors'

let backgroundGenerationWarningShown = false

export function isStreamingRequestBody(body: RequestInit['body'] | undefined): body is string {
  if (typeof body !== 'string') return false
  try {
    return JSON.parse(body).stream === true
  } catch {
    return false
  }
}

async function collectNativeResponse(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  const stream = createNativeReadableStream(
    {
      url,
      method,
      headers,
      body: typeof body === 'string' ? body : undefined,
    },
    { signal }
  )
  const responseData = await new Response(stream).text()
  return new Response(responseData, {
    // The current StreamHttp bridge does not expose response metadata. Model
    // SDKs still validate and surface JSON error payloads from the provider.
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleMobileRequest(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  signal?: AbortSignal
): Promise<Response> {
  // Fix: Convert Headers to plain object without using .entries()
  const headerObj: Record<string, string> = {}
  headers.forEach((value, key) => {
    headerObj[key] = value
  })
  const isStreaming = isStreamingRequestBody(body)

  if (isStreaming) {
    try {
      // Add SSE Accept header for proper content negotiation
      const streamHeaders = {
        ...headerObj,
        Accept: 'text/event-stream',
      }

      const keepRunningInBackground = settingsStore.getState().backgroundGenerationEnabled !== false
      const backgroundTaskId = `model-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const stream = createNativeReadableStream(
        {
          url,
          method,
          headers: streamHeaders,
          body,
        },
        {
          signal,
          // Background execution is an enhancement. If a device or OEM policy
          // rejects the foreground service, keep the model stream working in the
          // foreground instead of failing the entire conversation.
          onStart: keepRunningInBackground
            ? async () => {
                try {
                  await startBackgroundGeneration(backgroundTaskId)
                  backgroundGenerationWarningShown = false
                } catch (error) {
                  console.warn('Background generation unavailable; continuing without it', error)
                  if (!backgroundGenerationWarningShown) {
                    backgroundGenerationWarningShown = true
                    try {
                      // Load UI notification dependencies only after a real
                      // failure. Importing the UI store from this low-level
                      // request module during app bootstrap can create a module
                      // initialization cycle and leave the WebView blank.
                      const [{ t }, toastActions] = await Promise.all([
                        import('i18next'),
                        import('@/stores/toastActions'),
                      ])
                      toastActions.add(
                        t(
                          'Background protection could not start. This response will continue only while Chatbox remains active. Check Android battery and notification settings.'
                        ),
                        10000,
                        { label: t('Settings'), settingsPath: '/settings/chat' }
                      )
                    } catch (notificationError) {
                      console.warn('Unable to show background generation warning', notificationError)
                    }
                  }
                }
              }
            : undefined,
          onClose: () => {
            if (keepRunningInBackground) return stopBackgroundGeneration(backgroundTaskId)
          },
        }
      )

      // TODO: Once native plugin supports returning status/headers,
      // use them instead of hardcoded values
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      console.warn('Native streaming unavailable, falling back', err)
    }
  }

  let response
  try {
    response = await CapacitorHttp.request({
      url,
      method,
      headers: headerObj,
      data: body,
      responseType: 'text',
    })
  } catch (error) {
    // CapacitorHttp installs its own SSL socket factory on Android. On devices
    // using a user-installed CA for a private model endpoint that can reject a
    // certificate which the app's network security config explicitly trusts.
    // StreamHttp uses Android's normal HttpURLConnection trust configuration,
    // which is also the proven path used by streaming chat requests.
    console.warn('Buffered CapacitorHttp request failed; retrying through native HTTP', error)
    return collectNativeResponse(url, method, headerObj, body, signal)
  }

  const rawData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
  // CapacitorHttp reports some Android TLS/network failures as a synthetic
  // status-0 response instead of rejecting its promise. Retry that shape via
  // the same user-CA-aware native path used above.
  if (response.status === 0) {
    console.warn('Buffered CapacitorHttp request returned status 0; retrying through native HTTP')
    return collectNativeResponse(url, method, headerObj, body, signal)
  }
  if (response.status < 200 || response.status >= 400) {
    throw new ApiError(`Status Code ${response.status}`, rawData, response.status)
  }
  const responseData = rawData

  if (isStreaming) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(responseData))
        controller.close()
      },
    })
    return new Response(stream, {
      status: response.status,
      headers: { ...response.headers, 'Content-Type': 'text/event-stream' },
    })
  }

  return new Response(responseData, {
    status: response.status,
    headers: response.headers,
  })
}
