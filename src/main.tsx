import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

/** macOS / WebKit: disable spellcheck and auto-correction on all text inputs (incl. xterm’s textarea). */
function applyNoTextInputCorrections(el: HTMLInputElement | HTMLTextAreaElement) {
  el.spellcheck = false;
  el.setAttribute("autocorrect", "off");
  el.setAttribute("autocapitalize", "off");
}

function patchTextInputsUnder(root: ParentNode) {
  root.querySelectorAll("input, textarea").forEach((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      applyNoTextInputCorrections(node);
    }
  });
}

function installGlobalTextInputCorrectionsDisabled() {
  const onAdded = (n: Node) => {
    if (!(n instanceof HTMLElement)) return;
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
      applyNoTextInputCorrections(n);
    }
    patchTextInputsUnder(n);
  };

  patchTextInputsUnder(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        onAdded(n);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

queueMicrotask(() => {
  installGlobalTextInputCorrectionsDisabled();
});
