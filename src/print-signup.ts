import { icon } from "./icons.js";
import { track } from "./analytics.js";
import type { AppView } from "./types.js";

export interface PrintContext {
  view: AppView;
  year: number;
}

export interface PrintSignup {
  open(context: PrintContext): void;
}

// Netlify Forms takes the submission as a urlencoded POST to any page of the
// site; the form-name field routes it to the form detected at build time.
async function submit(form: HTMLFormElement): Promise<boolean> {
  const body = new URLSearchParams();
  for (const [key, value] of new FormData(form)) body.append(key, String(value));
  try {
    const response = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function createPrintSignup(): PrintSignup {
  const dialog = document.querySelector<HTMLDialogElement>("#print-dialog")!;
  const form = dialog.querySelector<HTMLFormElement>("#print-form")!;
  const status = dialog.querySelector<HTMLElement>("#print-status")!;
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const viewInput = form.querySelector<HTMLInputElement>('input[name="view"]')!;
  const yearInput = form.querySelector<HTMLInputElement>('input[name="year"]')!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("#print-close")!;
  closeButton.innerHTML = icon("close");

  let context: PrintContext | null = null;

  closeButton.addEventListener("click", () => dialog.close());
  // A click on the dialog element itself, rather than its contents, landed
  // on the backdrop.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitButton.disabled = true;
    status.textContent = "Sending…";
    const sent = await submit(form);
    submitButton.disabled = false;
    if (sent) {
      // Never the address itself: analytics only learns that a signup happened.
      if (context) track("print-signup", { view: context.view, year: context.year });
      form.hidden = true;
      status.textContent = "Thanks, you're on the list.";
    } else {
      status.textContent = "Couldn't send that. Please try again.";
    }
  });

  return {
    open(next) {
      context = next;
      viewInput.value = next.view;
      yearInput.value = String(next.year);
      // After a signup the thanks stays put; otherwise clear a stale error.
      if (!form.hidden) status.textContent = "";
      dialog.showModal();
    },
  };
}
