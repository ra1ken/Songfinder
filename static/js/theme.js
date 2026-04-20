document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const darkModeSelect = document.getElementById('dark-mode-select');
    const languageSelect = document.getElementById('language-select');

    if (darkModeSelect) {
        darkModeSelect.addEventListener('change', (e) => {
            updateSetting('dark_mode', e.target.value);
            applyTheme(e.target.value);
        });
    }

    if (languageSelect) {
        languageSelect.addEventListener('change', async (e) => {
            await updateSetting('language', e.target.value);
            window.location.reload();
        });
    }

    function applyTheme(mode) {
        let isDark = false;
        if (mode === 'on') {
            isDark = true;
        } else if (mode === 'system') {
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        }

        if (isDark) {
            document.documentElement.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
    }

    async function updateSetting(key, value) {
        try {
            const payload = {};
            payload[key] = value;

            await fetch('api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            console.log(`Updated ${key} to ${value}`);
        } catch (error) {
            console.error('Error saving setting:', error);
        }
    }

    // Listen for system theme changes if set to system
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (darkModeSelect && darkModeSelect.value === 'system') {
            applyTheme('system');
        } else if (!darkModeSelect && document.body.dataset.theme === 'system') {
            applyTheme('system');
        }
    });

    // Initial apply
    const initialTheme = body.dataset.theme || 'off';
    applyTheme(initialTheme);
});
