export type Theme = 'system' | 'light' | 'dark';

export const STORAGE_KEY = 'tidysky.theme';

/** Resolve a saved choice (and the OS preference) to a concrete theme. */
export function resolveTheme(saved: Theme, prefersDark: boolean): 'light' | 'dark' {
	if (saved === 'system') return prefersDark ? 'dark' : 'light';
	return saved;
}

/** Read the saved theme; 'system' when nothing is stored, it is invalid, or storage is blocked. */
export function loadTheme(): Theme {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === 'system' || value === 'light' || value === 'dark') return value;
	} catch {
		// localStorage unavailable (blocked or private mode): fall back to system.
	}
	return 'system';
}

/** Persist the theme choice; a no-op (with the choice still applied for this visit) if storage is blocked. */
export function saveTheme(theme: Theme): void {
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// localStorage unavailable: the choice applies for this visit only.
	}
}
