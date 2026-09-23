(function(root) {
  'use strict';

  function create(options) {
    const documentApi = options.document;
    const windowApi = options.window;
    const schedule = options.setTimeout || windowApi.setTimeout.bind(windowApi);

    function removeExisting() {
      documentApi.querySelector('.wp-toast')?.remove();
      documentApi.querySelector('.wp-snackbar')?.remove();
    }

    function position(element, anchor) {
      if (!anchor) return;
      const rectangle = anchor.getBoundingClientRect();
      element.style.top = `${rectangle.bottom + 10}px`;
      element.style.right = `${windowApi.innerWidth - rectangle.right}px`;
    }

    function reveal(element) {
      windowApi.requestAnimationFrame(() => element.classList.add('visible'));
    }

    function dismiss(element) {
      element.classList.remove('visible');
      schedule(() => element.remove(), 300);
    }

    function showToast(message, anchor) {
      removeExisting();
      const toast = documentApi.createElement('div');
      toast.className = 'wp-toast';
      toast.textContent = message;
      documentApi.body.appendChild(toast);
      position(toast, anchor);
      reveal(toast);
      schedule(() => dismiss(toast), 3000);
      return toast;
    }

    function appendAction(container, snackbar, text, callback, primary = false) {
      if (!text || !callback) return;
      const button = documentApi.createElement('button');
      button.className = `wp-snackbar-action${primary ? ' wp-snackbar-action-primary' : ''}`;
      button.textContent = text;
      button.addEventListener('click', () => {
        dismiss(snackbar);
        callback();
      });
      container.appendChild(button);
    }

    function showSnackbar(message, actionText, actionCallback, anchor,
        secondActionText, secondActionCallback) {
      removeExisting();
      const snackbar = documentApi.createElement('div');
      snackbar.className = 'wp-snackbar';
      const messageElement = documentApi.createElement('span');
      messageElement.className = 'wp-snackbar-message';
      messageElement.textContent = message;
      snackbar.appendChild(messageElement);

      const actions = documentApi.createElement('div');
      actions.className = 'wp-snackbar-actions';
      appendAction(actions, snackbar, actionText, actionCallback);
      appendAction(actions, snackbar, secondActionText, secondActionCallback, true);
      if (actions.children.length) snackbar.appendChild(actions);

      documentApi.body.appendChild(snackbar);
      position(snackbar, anchor);
      reveal(snackbar);
      schedule(() => dismiss(snackbar), 7000);
      return snackbar;
    }

    return Object.freeze({ showSnackbar, showToast });
  }

  root.EchoNtpNotificationView = Object.freeze({ create });
})(globalThis);
