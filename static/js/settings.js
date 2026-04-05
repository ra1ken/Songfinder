document.addEventListener('DOMContentLoaded', () => {
    const deleteBtn = document.getElementById('delete-account-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (confirm('Opravdu chcete nenávratně smazat svůj účet a všechny playlisty?')) {
                try {
                    const resp = await fetch('/api/user/delete', { method: 'DELETE' });
                    const data = await resp.json();
                    if (data.success) {
                        window.location.href = '/';
                    } else {
                        alert('Chyba při mazání účtu: ' + (data.error || 'Neznámá chyba'));
                    }
                } catch (err) {
                    console.error(err);
                    alert('Došlo k chybě při komunikaci se serverem.');
                }
            }
        });
    }
});
