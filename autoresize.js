window.addEventListener('message', receiveMessage, false);

function receiveMessage(evt) {
  let data;
  try {
    data = JSON.parse(evt.data);
  } catch (err) {
    console.warn('Invalid JSON received:', evt.data);
    return;
  }

  if (data.Sender !== "buvautoresize" || typeof data.Height !== 'number') return;

  const iframes = document.getElementsByTagName('iframe');
  for (const iframe of iframes) {
    if (iframe.contentWindow === evt.source) {
      iframe.style.height = `${data.Height}px`;
      break;
    }
  }
}
