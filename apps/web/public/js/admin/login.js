/**
 * Admin sign in: posts to the existing session API, then returns to the page
 * the admin originally asked for.
 */
(() => {
    'use strict';

    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const button = document.getElementById('login-button');
    const feedback = document.getElementById('login-feedback');
    const nextPath = form.dataset.next || '/admin/tips/new';

    function setFeedback(message, tone) {
        feedback.textContent = message || '';
        feedback.classList.toggle('is-hidden', !message);
        feedback.classList.toggle('alert', Boolean(tone));
        feedback.classList.toggle('alert--error', tone === 'error');
        feedback.classList.toggle('alert--success', tone === 'success');
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            setFeedback('Enter your email and password.', 'error');
            (email ? passwordInput : emailInput).focus();
            return;
        }

        button.disabled = true;
        button.textContent = 'Signing in…';
        setFeedback('', '');

        try {
            const response = await fetch('/api/v1/auth/login', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(
                    (typeof payload?.error === 'string' && payload.error)
                    || 'Sign in failed. Check your email and password.'
                );
            }

            setFeedback('Signed in. Loading the admin screen…', 'success');
            window.location.assign(nextPath);
        } catch (error) {
            setFeedback(error.message || 'Sign in failed', 'error');
            button.disabled = false;
            button.textContent = 'Sign in';
        }
    });

    emailInput.focus();
})();
