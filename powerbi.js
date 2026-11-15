const { drugs } = require('./catalog');

const url = 'https://wabi-west-europe-b-primary-api.analysis.windows.net/public/reports/querydata?synchronous=true';
const providerName = '38742846, КОМУНАЛЬНЕ НЕКОМЕРЦІЙНЕ МЕДИЧНЕ ПІДПРИЄМСТВО "ЦЕНТР ПЕРВИННОЇ МЕДИКО-САНІТАРНОЇ ДОПОМОГИ №3"  М. КРЕМЕНЧУКА';

function column(source, property) {
  return { Column: { Expression: { SourceRef: { Source: source } }, Property: property } };
}

function inFilter(expression, value) {
  return {
    Condition: {
      In: { Expressions: [expression], Values: [[{ Literal: { Value: value } }]] },
    },
  };
}

function quoted(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function createBody(year, drug, provider) {
  const dateLevels = ['Рік', 'Квартал', 'Місяць'].map((level) => ({
    HierarchyLevel: {
      Expression: {
        Hierarchy: { Expression: { SourceRef: { Source: 'c' } }, Hierarchy: 'Звітний період' },
      },
      Level: level,
    },
  }));

  const count = column('d1', 'Виписано рецептів');
  const notEqual = (value) => ({
    Not: {
      Expression: {
        Comparison: {
          ComparisonKind: 0,
          Left: count,
          Right: { Literal: { Value: value } },
        },
      },
    },
  });

  const command = {
    Query: {
      Version: 2,
      From: [
        { Name: 'c', Entity: 'calendar', Type: 0 },
        { Name: 'd', Entity: 'dwh_innms_groups', Type: 0 },
        { Name: 'd1', Entity: 'dwh_medication_requests', Type: 0 },
        { Name: 'd11', Entity: 'dwh_legal_entities', Type: 0 },
      ],
      Select: [
        ...dateLevels.map((expression) => ({
          ...expression,
          Name: 'calendar.Звітний період.' + expression.HierarchyLevel.Level,
        })),
        { ...column('d', 'Група захворювання'), Name: 'dwh_innms_groups.Категорія захворювання' },
        { Aggregation: { Expression: count, Function: 0 }, Name: 'Sum(nszu_medications_dashboard.count_mr)' },
      ],
      Where: [
        inFilter(column('d', 'Лікарський засіб (МНН)'), quoted(drug)),
        inFilter(column('d11', 'Надавач послуг'), quoted(provider)),
        inFilter(column('c', 'Year'), year + 'L'),
        { Condition: { Or: { Left: notEqual('null'), Right: notEqual('0L') } } },
      ],
      OrderBy: dateLevels.map((expression) => ({ Direction: 1, Expression: expression })),
    },
    Binding: {
      Primary: { Groupings: [{ Projections: [0, 1, 2, 4] }] },
      Secondary: { Groupings: [{ Projections: [3] }] },
      DataReduction: {
        DataVolume: 4,
        Primary: { Window: { Count: 200 } },
        Secondary: { Top: { Count: 60 } },
      },
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  };

  return createQueryBody(command, '43c9bf4f22b2b7d03450');
}

function createQueryBody(command, visualId) {
  return {
    version: '1.0.0',
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: command }] },
      QueryId: '',
      ApplicationContext: {
        DatasetId: 'c841d7bf-3dda-4970-80c0-adf494e68156',
        Sources: [{
          ReportId: '45b1227c-794f-4711-a24b-991458dfd9d2',
          VisualId: visualId,
        }],
      },
    }],
    cancelQueries: [],
    modelId: 2821748,
  };
}

function decodeMonthlyCounts(json, year) {
  const dataset = json.results?.[0]?.result?.data?.dsr?.DS?.[0];

  if (!dataset) {
    throw new Error('Power BI не повернув набір даних DS[0].');
  }

  const rows = dataset.PH?.[0]?.DM0 ?? [];
  const monthDictionary = dataset.ValueDicts?.D1;
  const monthNames = [
    'січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
    'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень',
  ];

  const totals = Array(12).fill(0);
  const group = []; // Рік, квартал, індекс місяця
  let previousCount;

  for (const row of rows) {
    let cursor = 0;

    for (let index = 0; index < 3; index++) {
      if (!((row.R ?? 0) & (1 << index))) {
        group[index] = row.C?.[cursor++];
      }
    }

    const monthName = monthDictionary?.[group[2]];
    const monthIndex = monthNames.indexOf(monthName?.trim().toLowerCase());

    if (Number(group[0]) !== year || monthIndex === -1 || !Array.isArray(row.X)) {
      throw new Error('Не вдалося розпізнати рік, місяць або показники Power BI.');
    }

    for (const cell of row.X) {
      if (Object.hasOwn(cell, 'M0')) {
        previousCount = cell.M0;
      } else if (!Object.hasOwn(cell, 'R')) {
        throw new Error('Невідомий формат показника Power BI.');
      }

      if (!Number.isFinite(previousCount)) {
        throw new Error('Power BI повернув некоректну кількість рецептів.');
      }

      totals[monthIndex] += previousCount;
    }
  }

  const today = new Date();
  return totals.map((count, index) => {
    const isFuture = year > today.getFullYear()
      || (year === today.getFullYear() && index > today.getMonth());

    return isFuture ? null : count;
  });
}

async function requestPowerBi(body) {
  const resourceKey = process.env.NSZU_RECIPES_RESOURCE_KEY;
  if (!resourceKey) {
    throw new Error('Задай NSZU_RECIPES_RESOURCE_KEY перед запуском.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PowerBI-ResourceKey': resourceKey,
      Origin: 'https://app.powerbi.com',
      Referer: 'https://app.powerbi.com/',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Power BI повернув HTTP ${response.status}`);
  }

  const json = await response.json();
  if (!json.results?.[0]?.result?.data?.dsr) {
    throw new Error('Power BI не повернув дані.');
  }

  return json;
}

async function fetchRecipeMonths(year, drug, provider) {
  const json = await requestPowerBi(createBody(year, drug, provider));
  return decodeMonthlyCounts(json, year);
}

async function getRecipeReport(year, provider, extraDrugs = []) {
  const name = provider === '38742846' ? providerName : provider;
  const rows = [];
  const seen = new Set();

  for (const drug of [...drugs.values(), ...extraDrugs]) {
    const key = drug.toLocaleLowerCase('uk-UA');
    if (seen.has(key)) continue;
    seen.add(key);

    const months = await fetchRecipeMonths(year, drug, name);
    rows.push({ drug, months });
  }

  return { year, rows };
}

async function getLookupSuggestions(term, { entity, property, operator, filters = [] }) {
  const field = column('d', property);

  const command = {
    Query: {
      Version: 2,
      From: [{ Name: 'd', Entity: entity, Type: 0 }],
      Select: [{ ...field, Name: `${entity}.${property}` }],
      Where: [
        {
          Condition: {
            [operator]: {
              Left: field,
              Right: { Literal: { Value: quoted(term) } },
            },
          },
        },
        ...filters,
      ],
    },
    Binding: {
      Primary: { Groupings: [{ Projections: [0] }] },
      DataReduction: { DataVolume: 4, Primary: { Window: { Count: 15 } } },
      IncludeEmptyGroups: true,
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  };

  const json = await requestPowerBi(createQueryBody(command, '7213cdc4007a1900002b'));
  const dataset = json.results[0].result.data.dsr.DS?.[0];
  const rows = dataset?.PH?.flatMap((group) => group.DM0 ?? []) ?? [];
  const dictionaryName = rows.find((row) => row.S)?.S?.[0]?.DN ?? 'D0';
  const dictionary = dataset?.ValueDicts?.[dictionaryName];

  const names = rows.map((row) => {
    const value = row.G0 ?? row.C?.[0];
    return Number.isInteger(value) ? dictionary?.[value] : value;
  });

  return [...new Set(names.filter((name) => typeof name === 'string' && name.trim()))]
    .slice(0, 15);
}

function getProviderSuggestions(term) {
  const isCode = /^\d{1,8}$/.test(term);
  const searchTerm = isCode && term.length === 8 ? `${term},` : term;

  return getLookupSuggestions(searchTerm, {
    entity: 'dwh_legal_entities',
    property: 'Надавач послуг',
    operator: isCode ? 'StartsWith' : 'Contains',
    filters: [inFilter(column('d', 'is_public'), 'true')],
  });
}

function getDrugSuggestions(term) {
  return getLookupSuggestions(term, {
    entity: 'dwh_innms_groups',
    property: 'Лікарський засіб (МНН)',
    operator: 'Contains',
  });
}

module.exports = { getRecipeReport, getProviderSuggestions, getDrugSuggestions };

