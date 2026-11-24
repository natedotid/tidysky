// Pre-paint theme: apply the saved choice (or the OS preference) before the
// first paint so dark mode never flashes. Loaded in <head> without defer or
// async on purpose: it must run before first paint. Plain ES5 on purpose,
// as in app.html before it was moved here (out of an inline <script>) for
// the content security policy.
(function () {
	var saved = 'system';
	try {
		var stored = localStorage.getItem('tidysky.theme');
		if (stored === 'system' || stored === 'light' || stored === 'dark') saved = stored;
		// The binding is required in ES5; the error is intentionally ignored.
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (e) {
		// storage blocked: fall back to the system preference
	}
	var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
	var dark = saved === 'dark' || (saved === 'system' && prefersDark);
	document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	if (dark) {
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', '#0E1420');
	}
})();
