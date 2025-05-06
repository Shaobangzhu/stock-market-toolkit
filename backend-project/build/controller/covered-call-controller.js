"use strict";
function simulateCoveredCall(input) {
    var results = [];
    var costBasis = input.costBasis, strikePrice = input.strikePrice, premium = input.premium, numShares = input.numShares;
    for (var price = 80; price <= 150; price += 1) {
        var profit = void 0;
        if (price < strikePrice) {
            // 未被行权：股票以市价计算
            profit = (price - costBasis) * numShares + premium * numShares;
        }
        else {
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
var input = {
    costBasis: 22.7,
    currentPrice: 124,
    strikePrice: 130,
    premium: 5.5,
    numShares: 500,
};
var profitSimulation = simulateCoveredCall(input);
console.log("Covered Call 盈亏模拟:");
console.table(profitSimulation);
