const loadButton = document.querySelector('#load-recipes');
const yearInput = document.querySelector('#recipe-year');
yearInput.value = new Date().getFullYear();
const providerSelect = document.querySelector('#recipe-provider');
const tableBody = document.querySelector('#recipe-rows');
const status = document.querySelector('#status');
const downloadButton = document.querySelector('#download-recipes');
let loadedReport = null;
let isExporting = false;
const extraDrugInput = document.querySelector('#extra-drug');
const addExtraDrugButton = document.querySelector('#add-extra-drug');
const extraDrugStatus = document.querySelector('#extra-drug-status');
const extraDrugList = document.querySelector('#extra-drug-list');
const extraDrugsKey = 'nszu-extra-drugs';

let extraDrugs = [];

try {
  const saved = JSON.parse(localStorage.getItem(extraDrugsKey) ?? '[]');
  if (Array.isArray(saved)) {
    extraDrugs = saved.filter((name) => typeof name === 'string' && name.trim());
  }
} catch {
  extraDrugStatus.textContent = 'Не вдалося прочитати збережені МНН.';
}

function renderExtraDrugs() {
  const items = extraDrugs.map((name) => {
    const item = document.createElement('li');
    item.textContent = name;
    return item;
  });

  extraDrugList.replaceChildren(...items);
}

function saveExtraDrugs(updated) {
  try {
    localStorage.setItem(extraDrugsKey, JSON.stringify(updated));
  } catch {
    extraDrugStatus.textContent = 'Не вдалося зберегти список МНН.';
    return false;
  }

  extraDrugs = updated;
  renderExtraDrugs();
  return true;
}

function renderExtraDrugs() {
  const items = extraDrugs.map((name, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const removeButton = document.createElement('button');

    label.textContent = name;
    removeButton.type = 'button';
    removeButton.textContent = '×';
    removeButton.className = 'extra-meds__delete-btn';
    removeButton.setAttribute('aria-label', `Видалити ${name}`);

    removeButton.addEventListener('click', () => {
      const updated = extraDrugs.filter((_, position) => position !== index);

      if (saveExtraDrugs(updated)) {
        extraDrugStatus.textContent = 'МНН видалено.';
        extraDrugInput.focus();
      }
    });

    item.append(label, ' ', removeButton);
    return item;
  });

  extraDrugList.replaceChildren(...items);
}

addExtraDrugButton.addEventListener('click', () => {
  const name = extraDrugInput.value.trim();

  if (!name) {
    extraDrugStatus.textContent = 'Введи назву препарату.';
    extraDrugInput.focus();
    return;
  }

  const key = name.toLocaleLowerCase('uk-UA');
  if (extraDrugs.some((drug) => drug.toLocaleLowerCase('uk-UA') === key)) {
    extraDrugStatus.textContent = 'Цей МНН уже додано.';
    return;
  }

  if (!saveExtraDrugs([...extraDrugs, name])) return;

  extraDrugStatus.textContent = 'МНН додано.';
  extraDrugInput.value = '';
  extraDrugInput.focus();
});

renderExtraDrugs();

let recipeChart;

function attachSuggestions(input, list, endpoint, createItem) {
  let timer;
  let controller;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    list.replaceChildren();

    const term = input.value.trim();
    if (term.length < 2) return;

    timer = setTimeout(async () => {
      const request = new AbortController();
      controller = request;
      const params = new URLSearchParams({ q: term });

      try {
        const response = await fetch(`${endpoint}?${params}`, {
          signal: request.signal,
        });

        if (!response.ok) return;

        const names = await response.json();
        if (request.signal.aborted || !Array.isArray(names)) return;

        const options = names.map((name) => {
          if (createItem) return createItem(name);
          const option = document.createElement('option');
          option.value = name;
          return option;
        });

        list.replaceChildren(...options);
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('Не вдалося завантажити підказки', error);
        }
      }
    }, 80);
  });
}

const providerSuggestions = document.querySelector('#provider-suggestions');

function resizeProviderField() {
  providerSelect.style.height = 'auto';
  const borderHeight = providerSelect.offsetHeight - providerSelect.clientHeight;
  providerSelect.style.height = `${providerSelect.scrollHeight + borderHeight}px`;
}

providerSelect.addEventListener('input', resizeProviderField);

attachSuggestions(
  providerSelect,
  providerSuggestions,
  '/api/suggestions/providers',
  (name) => {
    const item = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = name;

    button.addEventListener('click', () => {
      providerSelect.value = name;
      providerSuggestions.replaceChildren();
      resizeProviderField();
      providerSelect.focus();
    });

    item.append(button);
    return item;
  },
);

attachSuggestions(
  extraDrugInput,
  document.querySelector('#extra-drug-suggestions'),
  '/api/suggestions/drugs',
);

function updateRecipeChartTheme() {
  if (!recipeChart) return;

  const color = getComputedStyle(recipeChart.canvas)
    .getPropertyValue('--main-text')
    .trim();

  const { plugins, scales } = recipeChart.options;

  plugins.legend.labels.color = color;
  plugins.datalabels.color = color;
  scales.x.ticks.color = color;
  scales.y.ticks.color = color;

  const isDark = document.documentElement.dataset.theme === 'dark';
  const gridColor = isDark ? '#404040' : '#dddddd';

  scales.x.grid.color = gridColor;
  scales.y.grid.color = gridColor;

  recipeChart.update('none');
}

document.addEventListener('themechange', updateRecipeChartTheme);

const lineColors = [
  '#2563eb', '#dc2626', '#15803d', '#7c3aed', '#c2410c', '#0891b2',
  '#be185d', '#4d7c0f', '#4338ca', '#a16207', '#0f766e', '#db2777', '#0284c7', '#84cc16', '#ea580c', '#9333ea',
  '#e11d48', '#22a699', '#ca8a04', '#6b7280', '#a85562',
];

function renderRecipeChart(rows) {
  const visibility = new Map(
    recipeChart?.data.datasets.map((dataset, index) => [
      dataset.label,
      recipeChart.isDatasetVisible(index),
    ]) ?? [],
  );

  const datasets = rows.map(({ drug, months }, index) => ({
    label: drug,
    data: months,
    borderColor: lineColors[index % lineColors.length],
    backgroundColor: lineColors[index % lineColors.length],
    hidden: !(visibility.get(drug) ?? (index < 2)),
  }));

  if (!recipeChart) {
    recipeChart = new Chart(document.querySelector('#recipe-chart'), {
      type: 'line',
      plugins: [ChartDataLabels],
      data: {
        labels: ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер',
          'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'],
        datasets,
      },
      options: {
        plugins: {
          legend: { position: 'bottom' },
          onHover(_event, _item, legend) {
            legend.chart.canvas.style.cursor = 'pointer';
          },
          onLeave(_event, _item, legend) {
            legend.chart.canvas.style.cursor = '';
          },
          datalabels: {
            align: 'top',
            offset: 4,
            display: 'auto',
            formatter: (value) => value == null ? null : String(value),
            font: { size: 11 },
          },
        },
        scales: { y: { beginAtZero: true } },
      },
    });
    updateRecipeChartTheme();
    return;
  }

  recipeChart.data.datasets = datasets;
  recipeChart.update();
}

loadButton.addEventListener('click', async () => {
  const year = yearInput.value;
  const provider = providerSelect.value;
  const params = new URLSearchParams({ year, provider });

  for (const drug of extraDrugs) {
    params.append('extraDrug', drug);
  }

  loadButton.disabled = true;
  status.textContent = 'Завантажуємо статистику…';

  try {
    const response = await fetch(`/api/recipes?${params}`, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Не вдалося завантажити статистику.');
    }

    const rows = data.rows.map(({ drug, months }) => {
      const row = document.createElement('tr');

      for (const value of [drug, ...months]) {
        const cell = document.createElement('td');
        cell.textContent = value ?? '';
        row.append(cell);
      }

      return row;
    });

    tableBody.replaceChildren(...rows);
    loadedReport = {
      year: data.year,
      provider: provider.trim(),
      rows: data.rows,
    };

    downloadButton.disabled = isExporting || loadedReport.rows.length === 0;
    document.querySelector('#recipe-chart-section').hidden = false;
    renderRecipeChart(data.rows);
    const now = new Date();
    status.textContent = `Статистика за ${data.year} рік завантажена.`;

    if (data.year === now.getFullYear()) {
      const month = new Intl.DateTimeFormat('uk-UA', { month: 'long' }).format(now);
      status.textContent += ` Поточний місяць (${month}) ще триває. Дані за нього неповні.`;
    }
  } catch (error) {
    status.textContent = `Помилка: ${error.message}`;
  } finally {
    loadButton.disabled = false;
  }
});

downloadButton.addEventListener('click', async () => {
  if (!loadedReport?.rows.length || isExporting) return;

  const { year, provider, rows } = loadedReport;
  isExporting = true;
  downloadButton.disabled = true;

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Виписані рецепти', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });

    sheet.columns = [
      { width: 46 },
      ...Array.from({ length: 12 }, () => ({ width: 8 })),
    ];

    sheet.mergeCells('A1:M1');
    sheet.getCell('A1').value = `Виписані рецепти за ${year} рік`;
    sheet.getCell('A1').font = { bold: true };

    sheet.mergeCells('A2:M2');
    sheet.getCell('A2').value = provider;
    sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(2).height = 32;

    const header = sheet.addRow([
      'МНН / МІСЯЦІ',
      ...Array.from({ length: 12 }, (_, index) => index + 1),
    ]);
    header.font = { bold: true };

    for (const { drug, months } of rows) {
      const row = sheet.addRow([drug, ...months]);
      row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const file = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(file);

    const link = document.createElement('a');
    link.href = url;
    link.download = `Деталізація-створених-рецептів-${year}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error(error);
    status.textContent = 'Не вдалося створити файл Excel.';
  } finally {
    isExporting = false;
    downloadButton.disabled = !loadedReport?.rows.length;
  }
});