const form = document.querySelector("#settingsForm");
const apiTokenInput = document.querySelector("#apiToken");
const statusMessage = document.querySelector("#statusMessage");
const testAuthButton = document.querySelector("#testAuth");

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const settings = readForm();
  const response = await sendMessage({
    type: "SAVE_SETTINGS",
    settings
  });

  if (response.ok) {
    setStatus("Settings saved.");
  } else {
    setStatus(response.error.message, true);
  }
});

testAuthButton.addEventListener("click", async () => {
  const settings = readForm();
  await sendMessage({
    type: "SAVE_SETTINGS",
    settings
  });

  setStatus("Testing token...");
  const response = await sendMessage({ type: "TEST_AUTH" });

  if (response.ok) {
    const user = response.payload;
    setStatus(`Token works. Signed in as ${user.username || user.email || "Real-Debrid user"}.`);
  } else {
    setStatus(response.error.message, true);
  }
});

async function loadSettings() {
  const response = await sendMessage({ type: "GET_SETTINGS" });
  const settings = response.payload;

  apiTokenInput.value = settings.apiToken || "";
  const selectionMode = settings.selectionMode || "all";
  const radio = form.querySelector(`input[name="selectionMode"][value="${selectionMode}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function readForm() {
  const selectionMode = form.querySelector("input[name='selectionMode']:checked")?.value || "all";

  return {
    apiToken: apiTokenInput.value,
    selectionMode
  };
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
