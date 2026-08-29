(function () {
  const cards = Array.from(document.querySelectorAll('.feature-card'));
  if (cards.length === 0) return;

  let activeIndex = Math.max(0, cards.findIndex(card => card.classList.contains('active')));
  let isInteracting = false;
  let autoPlayInterval = null;
  const ANIMATION_DURATION = 4500;

  function setActiveCard(index) {
    cards.forEach((card, cardIndex) => {
      const isActive = cardIndex === index;
      const demoArea = card.querySelector('.demo-area');

      card.classList.toggle('active', isActive);

      if (!demoArea) return;
      demoArea.classList.remove('animating');
      if (isActive) {
        void demoArea.offsetWidth;
        demoArea.classList.add('animating');
      }
    });
    activeIndex = index;
  }

  function startAutoPlay() {
    if (autoPlayInterval) clearInterval(autoPlayInterval);
    autoPlayInterval = setInterval(() => {
      if (!isInteracting && !document.hidden) {
        setActiveCard((activeIndex + 1) % cards.length);
      }
    }, ANIMATION_DURATION);
  }

  cards.forEach((card, index) => {
    card.addEventListener('mouseenter', () => {
      isInteracting = true;
      setActiveCard(index);
    });

    card.addEventListener('mouseleave', () => {
      isInteracting = false;
      startAutoPlay();
    });

    card.addEventListener('focus', () => {
      isInteracting = true;
      setActiveCard(index);
    });

    card.addEventListener('blur', () => {
      isInteracting = false;
      startAutoPlay();
    });

    card.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const targetIndex = (index + delta + cards.length) % cards.length;
      setActiveCard(targetIndex);
      cards[targetIndex].focus();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setActiveCard(activeIndex);
  });

  setActiveCard(activeIndex);
  startAutoPlay();
})();
