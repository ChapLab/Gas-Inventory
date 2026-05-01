// FULL WORKING APP.JS (FINAL FIXED VERSION)

function api(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = getScriptUrl();
    if (!url) return reject(new Error("Missing Apps Script URL"));

    const callbackName = "cb_" + Date.now();

    window[callbackName] = function(data) {
      delete window[callbackName];
      script.remove();

      if (!data.ok) reject(new Error(data.error || "API error"));
      else resolve(data);
    };

    const params = new URLSearchParams({
      action,
      callback: callbackName,
      payload: JSON.stringify(payload)
    });

    const script = document.createElement("script");
    script.src = url + "?" + params.toString();
    script.onerror = () => reject(new Error("Connection failed"));

    document.body.appendChild(script);
  });
}
