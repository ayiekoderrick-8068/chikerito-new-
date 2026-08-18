const express = require("express");
const { SUPPORTED_CURRENCIES } = require("../currency");

const router = express.Router();

router.get("/currencies", (req, res) => {
  res.json({
    currencies: SUPPORTED_CURRENCIES,
    rateSemantics: "One transaction-currency unit expressed in base-currency units",
    rounding: "Half-up to the base currency's minor-unit precision",
  });
});

module.exports = router;
