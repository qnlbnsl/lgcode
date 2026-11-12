const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const deviceTheme = matchMedia('(prefers-color-scheme: dark)');
let manualTheme: 'light' | 'dark' | null = null;
try {
  const saved = localStorage.getItem('lgtm-marketing-theme');
  if (saved === 'light' || saved === 'dark') manualTheme = saved;
} catch { /* A manual choice still works for this page when storage is blocked. */ }
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  themeToggle.title = label;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
}
applyTheme(manualTheme ?? (deviceTheme.matches ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => {
  manualTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(manualTheme);
  try { localStorage.setItem('lgtm-marketing-theme', manualTheme); } catch { /* Keep the in-memory choice. */ }
});
deviceTheme.addEventListener('change', event => {
  if (!manualTheme) applyTheme(event.matches ? 'dark' : 'light');
});

const signupForm = document.querySelector<HTMLFormElement>('#signup-form')!;
const status = document.querySelector<HTMLParagraphElement>('#signup-status')!;
const submit = signupForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
signupForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled || !signupForm.reportValidity()) return;
  const data = new FormData(signupForm);
  submit.disabled = true;
  submit.textContent = 'Joining…';
  status.textContent = 'Saving your place…';
  status.dataset.state = 'loading';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: data.get('email'), consent: data.get('consent') === 'on', website: data.get('website') }),
      signal: controller.signal,
    });
    const result = await response.json() as { message?: string; error?: string };
    if (!response.ok) throw new Error(result.error || 'We couldn’t save your email. Please try again.');
    status.textContent = result.message ?? 'You’re on the list. We’ll be in touch.';
    status.dataset.state = 'success';
    signupForm.reset();
    submit.textContent = 'You’re on the list';
  } catch (error) {
    status.textContent = error instanceof Error && error.name !== 'AbortError' && error.name !== 'TypeError'
      ? error.message : 'We couldn’t reach the server. Please try again.';
    status.dataset.state = 'error';
    submit.textContent = 'Try again';
  } finally {
    clearTimeout(timeout);
    submit.disabled = false;
  }
});
const previewImage = document.querySelector<HTMLImageElement>('#workspace-image')!;
const video = document.querySelector<HTMLVideoElement>('#demo-video')!;
const previewButtons = document.querySelectorAll<HTMLButtonElement>('[data-preview]');
const watchVideo = document.querySelector<HTMLButtonElement>('#watch-video')!;
const previews = {
  board: ['/assets/product-desktop.png', 'Product mockup: a project sprint board alongside the project lead’s conversation.'],
  chat: ['/assets/product-chat.png', 'Product mockup: the project lead’s conversation, with questions, approvals, and a message composer.'],
} as const;
previewButtons.forEach(button => button.addEventListener('click', () => {
  const name = button.dataset.preview as keyof typeof previews;
  previewImage.src = previews[name][0];
  previewImage.alt = previews[name][1];
  previewImage.hidden = false;
  video.pause();
  video.hidden = true;
  watchVideo.setAttribute('aria-pressed', 'false');
  previewButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
fetch('/api/media').then(response => response.json()).then((media: { available: boolean }) => {
  if (!media.available) return;
  watchVideo.hidden = false;
  watchVideo.setAttribute('aria-pressed', 'false');
  document.querySelector('#video-note')!.textContent = 'See the team in action';
  watchVideo.addEventListener('click', () => {
    previewImage.hidden = true;
    video.hidden = false;
    if (!video.getAttribute('src')) video.src = '/assets/demo.mp4';
    video.playbackRate = 1.25;
    watchVideo.setAttribute('aria-pressed', 'true');
    previewButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
    video.play().catch(() => { /* Native playback controls remain available. */ });
  });
}).catch(() => { /* Screenshots remain available when media discovery fails. */ });
