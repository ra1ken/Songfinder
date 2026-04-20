document.addEventListener('DOMContentLoaded', () => {
    const T = window.SETTINGS_TRANSLATIONS || {};
    const deleteBtn = document.getElementById('delete-account-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (confirm(T.delete_account_confirm || 'Are you sure you want to delete your account?')) {
                try {
                    const resp = await fetch('api/user/delete', { 
                        method: 'DELETE',
                        headers: {
                            'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
                        }
                    });
                    const data = await resp.json();
                    if (data.success) {
                        window.location.href = './';
                    } else {
                        alert((T.delete_error || 'Error deleting account: ') + (data.error || ''));
                    }
                } catch (err) {
                    console.error(err);
                    alert(T.generic_error || 'A communication error occurred.');
                }
            }
        });
    }

    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPassword = document.getElementById('old-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            if (newPassword !== confirmPassword) {
                alert(T.password_match_error || 'Passwords do not match.');
                return;
            }

            try {
                const resp = await fetch('api/user/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
                    },
                    body: JSON.stringify({
                        old_password: oldPassword,
                        new_password: newPassword,
                        confirm_password: confirmPassword
                    })
                });
                const data = await resp.json();
                if (data.success) {
                    alert(T.password_changed || 'Password successfully changed.');
                    changePasswordForm.reset();
                } else {
                    alert('Error: ' + (data.error || 'Could not change password.'));
                }
            } catch (err) {
                console.error(err);
                alert(T.generic_error || 'A communication error occurred.');
            }
        });
    }
});
