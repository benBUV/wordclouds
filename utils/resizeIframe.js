export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function resizeIframe() {
  const height = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.offsetHeight
  ) + 20;
  const cappedHeight = Math.min(height, 1000);
  if (height > 1000) {
    console.warn(`Excessive scrollHeight: ${height}px, using cappedHeight: ${cappedHeight}px`);
  }
  console.log(`Sending lti.frameResize with height: ${cappedHeight}px`);
  window.parent.postMessage(
    JSON.stringify({ subject: "lti.frameResize", height: `${cappedHeight}px` }),
    "*"
  );
}
