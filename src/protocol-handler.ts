import type { GetProtocol } from "./dem-source";

export default function registerMapLibreProtocolHandler(getProtocol: GetProtocol, worker: Worker) {
    const idPrefix = 'maplibre-contours-get-data-'
    worker.addEventListener('message', async e => {
        if (!e.data || (typeof e.data.id !== 'string') || !e.data.id.startsWith(idPrefix)) {
            return
        }

        const protocol = getProtocol(e.data.payload.url)
        if (!protocol) throw new Error(`No registered protocol handler for ${e.data.url}`)

        const result = await protocol(e.data.payload, new AbortController())

        const data = new Blob([result.data])
        worker.postMessage({
            id: e.data.id,
            payload: {
                ...result,
                data
            }
        }, [result.data])
    })
}
