(function () {
  const REQUIRED_FIELDS = ['date', 'symbol', 'action', 'quantity', 'price'];
  const OPTIONAL_FIELDS = ['name', 'fee'];
  const TARGET_FIELDS = [
    ...REQUIRED_FIELDS.slice(0, 2),
    'name',
    ...REQUIRED_FIELDS.slice(2),
    'fee',
  ];

  const FIELD_LABELS = {
    date: '日期',
    symbol: '代號',
    name: '名稱',
    action: '買賣',
    quantity: '股數',
    price: '單價',
    fee: '手續費',
  };

  // 常見券商匯出檔的欄名別名（比對時先 trim + 轉小寫）
  const FIELD_ALIASES = {
    date: [
      'date',
      'trade date',
      'tradedate',
      '成交日期',
      '交易日期',
      '委託日期',
      '日期',
    ],
    symbol: [
      'symbol',
      'ticker',
      'code',
      'stock code',
      '股票代號',
      '證券代號',
      '股票代碼',
      '證券代碼',
      '代號',
      '代碼',
    ],
    name: [
      'name',
      'description',
      'stock name',
      '股票名稱',
      '證券名稱',
      '商品名稱',
      '名稱',
    ],
    action: [
      'action',
      'side',
      'type',
      'transaction type',
      '買賣',
      '買賣別',
      '交易別',
      '交易類別',
      '交易種類',
    ],
    quantity: [
      'quantity',
      'qty',
      'shares',
      '股數',
      '成交股數',
      '成交數量',
      '數量',
    ],
    price: [
      'price',
      'unit price',
      '成交價',
      '成交價格',
      '成交單價',
      '單價',
      '價格',
    ],
    fee: ['fee', 'fees', 'commission', '手續費', '費用'],
  };

  const ACTION_ALIASES = {
    buy: 'buy',
    b: 'buy',
    買: 'buy',
    買進: 'buy',
    現買: 'buy',
    融買: 'buy',
    融資買進: 'buy',
    sell: 'sell',
    s: 'sell',
    賣: 'sell',
    賣出: 'sell',
    現賣: 'sell',
    融賣: 'sell',
    融券賣出: 'sell',
  };

  window.PFD = window.PFD || {};
  window.PFD.fields = {
    REQUIRED_FIELDS,
    OPTIONAL_FIELDS,
    TARGET_FIELDS,
    FIELD_LABELS,
    FIELD_ALIASES,
    ACTION_ALIASES,
  };
})();
