const express = require('express');
const path = require('node:path');
const { cities, regions, drugs, regionCenters } = require('./catalog');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets/fonts', express.static(path.join(__dirname, 'assets', 'fonts')));
app.use('/assets/img', express.static(path.join(__dirname, 'assets', 'img')));

const { getRecipeReport, getProviderSuggestions, getDrugSuggestions } = require('./powerbi');

app.get('/api/recipes', async (req, res) => {
  const { year: yearParam, provider } = req.query;
  const year = Number(yearParam);

  if (typeof yearParam !== 'string' || !/^\d{4}$/.test(yearParam) || year < 2000 || year > 2500) {
    return res.status(400).json({ error: 'Вкажи рік від 2000 до 2500.' });
  }

  const providerValue = typeof provider === 'string' ? provider.trim() : '';

  if (!providerValue) {
    return res.status(400).json({ error: 'Вибери надавача послуг.' });
  }

  const rawExtraDrugs = req.query.extraDrug;
  const extraDrugs = rawExtraDrugs === undefined
    ? []
    : Array.isArray(rawExtraDrugs) ? rawExtraDrugs : [rawExtraDrugs];

  if (extraDrugs.some((name) => typeof name !== 'string' || !name.trim() || name.trim().length > 400)) {
    return res.status(400).json({ error: 'Перевір назви додаткових МНН.' });
  }

  try {
    return res.json(await getRecipeReport(year, providerValue, extraDrugs.map((name) => name.trim())));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

app.get('/api/suggestions/providers', async (req, res) => {
  const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (term.length < 2) return res.json([]);

  try {
    return res.json(await getProviderSuggestions(term));
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: 'Не вдалося отримати підказки надавачів.' });
  }
});

app.get('/api/suggestions/drugs', async (req, res) => {
  const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (term.length < 2) return res.json([]);

  if (term.length > 200) {
    return res.status(400).json({ error: 'Введи до 200 символів.' });
  }

  try {
    return res.json(await getDrugSuggestions(term));
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: 'Не вдалося отримати підказки МНН.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер працює на порту ${PORT}`);
});