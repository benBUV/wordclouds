window.addEventListener('message', receiveMessage, false);

function receiveMessage(evt) {
  let data;
  try {
    data = JSON.parse(evt.data);
  } catch (err) {
    console.warn('Invalid JSON received:', evt.data);
    return;
  }

  if (data.Sender !== "buvautoresize" || typeof data.Height !== 'number') {
    return;
  }

  // Validate height
  if (data.Height < 0 || data.Height > 10000) {
    console.warn('Invalid height received:', data.Height);
    return;
  }

  const iframes = document.getElementsByTagName('iframe');
  for (const iframe of iframes) {
    if (iframe.contentWindow === evt.source) {
      const currentHeight = parseFloat(iframe.style.height) || 0;
      if (Math.abs(currentHeight - data.Height) > 1) {
        console.log('Updating iframe height to:', data.Height, 'for:', iframe.src);
        iframe.style.height = `${data.Height}px`;
      }
      break;
    }
  }
}
