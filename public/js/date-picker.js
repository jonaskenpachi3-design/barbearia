'use strict';

(() => {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const inputs = document.querySelectorAll('input[type="date"]');
  if (!inputs.length) return;

  const button = (className, text, label) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    if (label) element.setAttribute('aria-label', label);
    return element;
  };

  const popover = document.createElement('div');
  popover.id = 'date-picker-popover';
  popover.className = 'date-picker-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Selecione uma data');
  popover.hidden = true;

  const header = document.createElement('div');
  header.className = 'date-picker-header';
  const previous = button('date-picker-nav', '‹', 'Mês anterior');
  const monthTitle = document.createElement('div');
  monthTitle.className = 'date-picker-month';
  monthTitle.id = 'date-picker-month';
  monthTitle.setAttribute('role', 'heading');
  monthTitle.setAttribute('aria-level', '2');
  popover.setAttribute('aria-labelledby', monthTitle.id);
  const next = button('date-picker-nav', '›', 'Próximo mês');
  header.append(previous, monthTitle, next);

  const weekdaysRow = document.createElement('div');
  weekdaysRow.className = 'date-picker-weekdays';
  weekdaysRow.setAttribute('role', 'row');
  weekdays.forEach((name) => {
    const day = document.createElement('span');
    day.setAttribute('role', 'columnheader');
    day.textContent = name;
    weekdaysRow.append(day);
  });

  const grid = document.createElement('div');
  grid.className = 'date-picker-grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-labelledby', monthTitle.id);

  const footer = document.createElement('div');
  footer.className = 'date-picker-footer';
  const clear = button('date-picker-action', 'Limpar');
  const todayButton = button('date-picker-action date-picker-today', 'Hoje');
  footer.append(clear, todayButton);
  popover.append(header, weekdaysRow, grid, footer);
  document.body.append(popover);

  let activeInput = null;
  let activeTrigger = null;
  let visibleMonth = new Date();
  let activeDate = new Date();

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1])
      && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3]) ? date : null;
  }

  function toISO(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isAllowed(date) {
    if (!activeInput) return false;
    const value = toISO(date);
    return (!activeInput.min || value >= activeInput.min)
      && (!activeInput.max || value <= activeInput.max);
  }

  function hasAllowedDateInMonth(month) {
    if (!activeInput) return false;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return (!activeInput.min || toISO(last) >= activeInput.min)
      && (!activeInput.max || toISO(first) <= activeInput.max);
  }

  function clampToAllowedRange(date) {
    const value = toISO(date);
    if (activeInput.min && value < activeInput.min) return parseDate(activeInput.min);
    if (activeInput.max && value > activeInput.max) return parseDate(activeInput.max);
    return date;
  }

  function shiftMonth(date, amount) {
    const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
    target.setDate(Math.min(date.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    return target;
  }

  function focusDateButton(date) {
    const target = grid.querySelector(`[data-date="${toISO(date)}"]`);
    if (target && !target.disabled) target.focus();
  }

  function renderCalendar() {
    monthTitle.textContent = monthFormat.format(visibleMonth);
    previous.disabled = !hasAllowedDateInMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1));
    next.disabled = !hasAllowedDateInMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
    grid.replaceChildren();

    const firstOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const offset = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - offset);
    const selected = parseDate(activeInput.value);
    const activeKey = isAllowed(activeDate) ? toISO(activeDate) : '';
    const todayKey = toISO(new Date());

    for (let week = 0; week < 6; week++) {
      const row = document.createElement('div');
      row.className = 'date-picker-week';
      row.setAttribute('role', 'row');

      for (let day = 0; day < 7; day++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day);
        const value = toISO(date);
        const cell = document.createElement('div');
        cell.className = 'date-picker-cell';
        cell.setAttribute('role', 'gridcell');
        if (selected && value === toISO(selected)) cell.setAttribute('aria-selected', 'true');
        if (value === todayKey) cell.setAttribute('aria-current', 'date');

        const dateButton = button('date-picker-day', String(date.getDate()));
        dateButton.dataset.date = value;
        dateButton.setAttribute('aria-label', dayFormat.format(date));
        dateButton.setAttribute('aria-pressed', selected && value === toISO(selected) ? 'true' : 'false');
        dateButton.tabIndex = value === activeKey ? 0 : -1;
        dateButton.disabled = !isAllowed(date);
        if (date.getMonth() !== visibleMonth.getMonth()) dateButton.classList.add('is-outside-month');
        if (value === todayKey) dateButton.classList.add('is-today');
        if (selected && value === toISO(selected)) dateButton.classList.add('is-selected');
        dateButton.addEventListener('click', () => selectDate(date));
        cell.append(dateButton);
        row.append(cell);
      }

      grid.append(row);
    }

    clear.disabled = !activeInput.value;
    todayButton.disabled = !isAllowed(new Date());
  }

  function positionPopover() {
    if (!activeInput || popover.hidden) return;
    const anchor = activeInput.getBoundingClientRect();
    const panel = popover.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - panel.width - margin));
    const below = window.innerHeight - anchor.bottom;
    const top = below >= panel.height + margin || below >= anchor.top
      ? anchor.bottom + margin
      : Math.max(margin, anchor.top - panel.height - margin);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function closePicker(returnFocus) {
    if (!activeInput) return;
    const input = activeInput;
    input.setAttribute('aria-expanded', 'false');
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    popover.hidden = true;
    activeInput = null;
    activeTrigger = null;
    if (returnFocus && input.isConnected) input.focus({ preventScroll: true });
  }

  function openPicker(input, trigger) {
    if (input.disabled) return;
    if (activeInput && activeInput !== input) closePicker(false);
    activeInput = input;
    activeTrigger = trigger;
    const selected = parseDate(input.value);
    const today = new Date();
    activeDate = selected && isAllowed(selected) ? selected
      : isAllowed(today) ? today
        : parseDate(input.min) || parseDate(input.max) || today;
    visibleMonth = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
    input.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-expanded', 'true');
    renderCalendar();
    popover.hidden = false;
    positionPopover();
    focusDateButton(activeDate);
  }

  function selectDate(date) {
    if (!activeInput || !isAllowed(date)) return;
    const input = activeInput;
    input.value = toISO(date);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closePicker(true);
  }

  function changeMonth(amount) {
    const targetMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1);
    if (!hasAllowedDateInMonth(targetMonth)) return;
    activeDate = clampToAllowedRange(shiftMonth(activeDate, amount));
    visibleMonth = targetMonth;
    renderCalendar();
    focusDateButton(activeDate);
    positionPopover();
  }

  previous.addEventListener('click', () => changeMonth(-1));
  next.addEventListener('click', () => changeMonth(1));
  clear.addEventListener('click', () => {
    if (!activeInput) return;
    const input = activeInput;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closePicker(true);
  });
  todayButton.addEventListener('click', () => selectDate(new Date()));

  grid.addEventListener('keydown', (event) => {
    if (!activeInput) return;
    const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (movement) {
      event.preventDefault();
      const candidate = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate() + movement);
      if (!isAllowed(candidate)) return;
      activeDate = candidate;
      visibleMonth = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
      renderCalendar();
      focusDateButton(activeDate);
      positionPopover();
      return;
    }

    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const amount = (event.key === 'PageUp' ? -1 : 1) * (event.ctrlKey ? 12 : 1);
      changeMonth(amount);
    }
  });

  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker(true);
      return;
    }
    if (event.key !== 'Tab') return;
    setTimeout(() => {
      if (activeInput && !popover.contains(document.activeElement)) closePicker(false);
    }, 0);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!activeInput) return;
    const wrapper = activeInput.parentElement;
    if (!popover.contains(event.target) && !wrapper.contains(event.target)) closePicker(false);
  });
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, true);

  inputs.forEach((input, index) => {
    const label = input.labels && input.labels.length ? input.labels[0].textContent.trim() : 'data';
    const wrapper = document.createElement('div');
    wrapper.className = 'date-picker-control';
    wrapper.dataset.datePicker = 'true';
    ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'minWidth', 'maxWidth'].forEach((property) => {
      if (!input.style[property]) return;
      wrapper.style[property] = input.style[property];
      input.style[property] = '';
    });

    const trigger = button('date-picker-trigger', '', `Abrir calendário para ${label}`);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', popover.id);
    trigger.setAttribute('aria-expanded', 'false');
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNamespace, 'use');
    use.setAttribute('href', 'icons/icons.svg#icon-calendar');
    icon.append(use);
    trigger.append(icon);

    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-controls', popover.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('inputmode', 'none');
    input.dataset.datePicker = 'true';
    const parent = input.parentElement;
    parent.insertBefore(wrapper, input);
    wrapper.append(input, trigger);

    trigger.addEventListener('click', () => openPicker(input, trigger));
    input.addEventListener('click', (event) => {
      event.preventDefault();
      openPicker(input, trigger);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      openPicker(input, trigger);
    });
  });
})();
