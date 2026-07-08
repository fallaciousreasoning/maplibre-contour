import "whatwg-fetch";
global.fetch = jest.fn();
performance.now = () => Date.now();

// jsdom's Blob doesn't implement `arrayBuffer()`; production code gets this from the polyfill
// in dem-source.ts, but tests that don't import that module need it too.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = (event) =>
        resolve(event.target?.result as ArrayBuffer);
      fileReader.onerror = reject;
      fileReader.readAsArrayBuffer(this);
    });
  };
}
