export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

let lastSentHeight = 0;
const HEIGHT_THRESHOLD = 5; // Ignore changes smaller than 5px to prevent jitter

export const resizeIframe = debounce(function () {
  requestAnimationFrame(() => {
    // Calculate the height based on the content
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );

    // Only send the message if the height change is significant
    if (Math.abs(height - lastSentHeight) > HEIGHT_THRESHOLD) {
      const heightWithPadding = height + 10; // Add minimal padding
      console.log(`Sending resize message with height: ${heightWithPadding}px`);
      window.parent.postMessage(
        JSON.stringify({
          subject: "lti.frameResize",
          height: `${heightWithPadding}px`
        }),
        "*"
      );
      lastSentHeight = heightWithPadding; // Update the last sent height
    } else {
      console.log(`Height change too small (${height}px vs ${lastSentHeight}px), skipping resize`);
    }
  });
}, 150);
