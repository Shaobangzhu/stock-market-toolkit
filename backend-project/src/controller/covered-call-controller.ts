type CoveredCallInput = {
  costBasis: number; // 每股成本价
  currentPrice: number; // 当前股价
  strikePrice: number; // Call行权价
  premium: number; // 每股权利金
  numShares: number; // 持股数量（如500）
};

type ProfitPoint = {
  stockPriceAtExpiry: number;
  totalProfit: number;
};

function simulateCoveredCall(input: CoveredCallInput): ProfitPoint[] {
  const results: ProfitPoint[] = [];
  const { costBasis, strikePrice, premium, numShares } = input;

  for (let price = 80; price <= 150; price += 1) {
    let profit: number;

    if (price < strikePrice) {
      // 未被行权：股票以市价计算
      profit = (price - costBasis) * numShares + premium * numShares;
    } else {
      // 被行权：股票以行权价计算
      profit = (strikePrice - costBasis) * numShares + premium * numShares;
    }

    results.push({
      stockPriceAtExpiry: price,
      totalProfit: parseFloat(profit.toFixed(2)),
    });
  }

  return results;
}

// 示例调用
const input: CoveredCallInput = {
  costBasis: 22.7,
  currentPrice: 124,
  strikePrice: 130,
  premium: 5.5,
  numShares: 500,
};

const profitSimulation = simulateCoveredCall(input);
console.log("Covered Call 盈亏模拟:");
console.table(profitSimulation);
