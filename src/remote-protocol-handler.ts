import type { FetchResponse } from "./types";

let id = 0;

const callbacks: {
  [id: string]: (response: FetchResponse) => void;
} = {};

self.addEventListener("message", ({ data: { id, payload } }) => {
  callbacks[id]?.(payload);
  delete callbacks[id]
});

export const getData = (
  url: string,
  abortController: AbortController
): Promise<FetchResponse> => {
  if (url.startsWith("https://")) {
    return fetch(url, {
      signal: abortController.signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Bad response: ${response.status} for ${url}`);
      }

      return {
        data: await response.blob(),
        expires: response.headers.get("expires") || undefined,
        cacheControl: response.headers.get("cache-control") || undefined,
      };
    });
  }

  const eventId = `maplibre-contours-get-data-${id++}`;
  self.postMessage({
    id: eventId,
    payload: {
      url,
    },
  });

  const { promise, resolve } = Promise.withResolvers<FetchResponse>();
  callbacks[eventId] = resolve

  return promise;
};
(self as any)['getData'] = getData;
(self as any)['callbacks'] = callbacks;
