export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export const resizeIframe = debounce(function () {
  requestAnimationFrame(() => {
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    ) + 10; // Reduced padding to 10px
    console.log(`Sending resize message with height: ${height}px`);
    window.parent.postMessage(
      JSON.stringify({
        subject: "lti.frameResize",
        height: `${height}px`
      }),
      "*"
    );
  });
}, 150);
