import type { CurrencyRateSnapshot, CurrencyRow, ProductIncrease, SellingEntry } from './storage';

export type DashboardSalesRow = { row: CurrencyRow; sold: number; retailerSold: number; collected: number | null; updatedAt: string; hasLog: boolean };
export type DashboardSalesSummary = { rows: DashboardSalesRow[]; sold: number; available: number; collected: number | null };

export function calculateDashboardSales(
  allRows: CurrencyRow[],
  increases: ProductIncrease[],
  sellingEntries: SellingEntry[],
  hasExcludedRecords = false,
): DashboardSalesSummary {
  const activeRows = allRows.filter(row => row.active);
  const increaseById = new Map(increases.map(item => [item.sourceId, item.increaseInr]));
  const saleById = new Map(sellingEntries.map(item => [item.sourceId, item]));
  const rows = activeRows.map(row => {
    const sale = saleById.get(row.id);
    const directSold = sale?.soldCount ?? 0;
    const retailerSold = sale?.retailerSoldCount ?? 0;
    const sold = directSold + retailerSold;
    const price = increaseById.get(row.id);
    const directCollected = directSold > 0 && price === undefined ? null : (price ?? 0) * directSold;
    const retailerPrice = sale?.retailerAmountInr;
    const retailerCollected = retailerSold > 0 && retailerPrice === undefined ? null : (retailerPrice ?? 0) * retailerSold;
    return {
      row,
      sold,
      retailerSold,
      collected: directCollected === null || retailerCollected === null ? null : directCollected + retailerCollected,
      updatedAt: sale?.updatedAt ?? row.date,
      hasLog: Boolean(sale),
    };
  }).sort((left, right) => Date.parse(right.row.date) - Date.parse(left.row.date));
  const collectionComplete = !hasExcludedRecords && rows.every(item => item.collected !== null);
  return {
    rows,
    sold: rows.reduce((total, item) => total + item.sold, 0),
    available: rows.reduce((total, item) => {
      return total + Math.max(0, item.row.productCount - item.sold);
    }, 0),
    collected: collectionComplete ? rows.reduce((total, item) => total + (item.collected ?? 0), 0) : null,
  };
}

export type CompanyGrowthSummary = {
  soldUnits: number;
  retailerSoldUnits: number;
  revenue: number | null;
  retailerRevenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  ledgerExpenses: number | null;
  netProfit: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  stock: number;
  retailerRows: { row: CurrencyRow; amount: number | null; count: number }[];
};

export function calculateCompanyGrowth(input: {
  rows: CurrencyRow[];
  increases: ProductIncrease[];
  sales: SellingEntry[];
  rate: CurrencyRateSnapshot | null;
  operatingExpenses: number | null;
  ledgerExpenses: number | null;
  hasExcludedRecords: boolean;
}): CompanyGrowthSummary {
  const active = input.rows.filter(row => row.active);
  const prices = new Map(input.increases.map(item => [item.sourceId, item.increaseInr]));
  const sales = new Map(input.sales.map(item => [item.sourceId, item]));
  let soldUnits = 0;
  let retailerSoldUnits = 0;
  let revenue = 0;
  let retailerRevenue = 0;
  let revenueComplete = !input.hasExcludedRecords;
  let retailerRevenueComplete = !input.hasExcludedRecords;
  let costOfGoods = 0;
  let hasSoldUnits = false;
  const retailerRows: CompanyGrowthSummary['retailerRows'] = [];

  for (const row of active) {
    const sale = sales.get(row.id);
    const directCount = sale?.soldCount ?? 0;
    const retailCount = sale?.retailerSoldCount ?? 0;
    const companyPrice = prices.get(row.id);
    const retailerPrice = sale?.retailerAmountInr;
    soldUnits += directCount + retailCount;
    retailerSoldUnits += retailCount;
    hasSoldUnits ||= directCount + retailCount > 0;
    if (directCount > 0) {
      if (companyPrice === undefined) revenueComplete = false;
      else revenue += directCount * companyPrice;
    }
    if (retailCount > 0) {
      if (retailerPrice === undefined) {
        retailerRevenueComplete = false;
        revenueComplete = false;
      } else {
        retailerRevenue += retailCount * retailerPrice;
      }
    }
    if (input.rate) costOfGoods += row.usd * input.rate.usdToInr * (directCount + retailCount);
    const hasRetailData = retailerPrice !== undefined || retailCount > 0;
    if (hasRetailData) retailerRows.push({ row, amount: retailerPrice ?? null, count: retailCount });
  }

  const revenueKnown = revenueComplete;
  const retailerRevenueKnown = retailerRevenueComplete;
  const cogsKnown = !input.hasExcludedRecords && (!hasSoldUnits || input.rate !== null);
  const revenueValue = revenueKnown ? revenue + retailerRevenue : null;
  const retailerRevenueValue = retailerRevenueKnown ? retailerRevenue : null;
  const cogsValue = cogsKnown ? costOfGoods : null;
  const grossProfit = revenueValue !== null && cogsValue !== null ? revenueValue - cogsValue : null;
  const netProfit = grossProfit !== null && input.operatingExpenses !== null ? grossProfit - input.operatingExpenses : null;
  const grossMargin = revenueValue !== null && revenueValue !== 0 && grossProfit !== null ? grossProfit / revenueValue * 100 : null;
  const netMargin = revenueValue !== null && revenueValue !== 0 && netProfit !== null ? netProfit / revenueValue * 100 : null;
  const stock = active.reduce((sum, row) => sum + Math.max(0, row.productCount - (sales.get(row.id)?.soldCount ?? 0) - (sales.get(row.id)?.retailerSoldCount ?? 0)), 0);

  return {
    soldUnits,
    retailerSoldUnits,
    revenue: revenueValue,
    retailerRevenue: retailerRevenueValue,
    cogs: cogsValue,
    grossProfit,
    operatingExpenses: input.operatingExpenses,
    ledgerExpenses: input.ledgerExpenses,
    netProfit,
    grossMargin,
    netMargin,
    stock,
    retailerRows,
  };
}
