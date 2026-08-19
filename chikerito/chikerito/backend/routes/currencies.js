const express = require("express");
const { SUPPORTED_CURRENCIES, USD_REFERENCE_VALUES, RATE_TABLE_VERSION } = require("../currency");

const router = express.Router();

router.get("/currencies", (req, res) => {
  res.json({
    currencies: SUPPORTED_CURRENCIES,
    usdReferenceValues: USD_REFERENCE_VALUES,
    rateTableVersion: RATE_TABLE_VERSION,
    rateSource: "server-owned reference table",
    rateSemantics: "One transaction-currency unit expressed in base-currency units",
    rounding: "Half-up to the base currency's minor-unit precision",
  });
});

module.exports = router;
