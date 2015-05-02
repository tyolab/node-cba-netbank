// Dependencies
var cheerio = require('cheerio');
var string = require('string');
var moment = require('moment');

// Constructor
var parser = module.exports = {};

parser.parseForm = function (page, callback) {
	var form = {};

	// reference: cheerio/lib/api/forms.js
	var $ = cheerio.load(page);
	$('form').map(function () {
		return cheerio(this).find('input,select,textarea,keygen').toArray();
	}).filter(
		'[name!=""]:not(:image, :reset, :file):matches([checked], :not(:checkbox, :radio))'
	).each(function (i, elem) {
		var $elem = cheerio(elem);
		var name = $elem.attr('name');
		var val = $elem.val();

		if (string(val).isEmpty()) {
			form[name] = ($elem.attr('type') === 'checkbox') ? 'on' : '';
		} else {
			if (Array.isArray(val)) {
				//  ignore multiple selection
				return;
			} else {
				form[name] = val.replace(/\r?\n/g, '\r\n');
			}
		}
	});

	callback(null, form);
};

//	Account format:
// {
// 	nickname,
// 	url,
// 	bsbNumber,
// 	accountNumber,
// 	number,
// 	balance
// }
parser.parseAccountList = function (page, callback) {
	var accounts = [];

	var $ = cheerio.load(page);
	$('div#myPortfolioDiv').find('tr.main_group_account_row').each(function (i,
		e) {
		var account = {};
		var tag = $(e).find('td.NicknameField a');
		account.nickname = tag.html();
		account.url = tag.attr('href');
		account.bsbNumber = $(e).find('td.BSBField span.text').html();
		if (string(account.bsbNumber).isEmpty()) {
			account.bsbNumber = '';
		}
		account.accountNumber = $(e).find('td.AccountNumberField span.text')
			.html();
		account.number = (account.bsbNumber + account.accountNumber).replace(
			/\s+/g, '');

		//  parse the balance to a double number.
		//  Positive is CR, and negative is DR.

		var balance = $(e).find('td.AccountBalanceField span.Currency').html();
		var debitOrCredit = $(e).find(
			'td.AccountBalanceField span.PostFieldText').html();
		if (balance !== null) {
			balance = Number(balance.replace(/[^0-9\.]+/g, ''));
			switch (debitOrCredit) {
			case 'DR':
				balance = -balance;
				break;
			}
			account.balance = balance;
		}
		//	validate the account info
		if (!string(account.nickname).isEmpty() && !string(account.url).isEmpty() &&
			!string(account.accountNumber).isEmpty()) {
			accounts.push(account);
		}
	});

	callback(null, accounts);
}

parser.parseHomePage = function (page, callback) {
	parser.parseForm(page, function (error, form) {
		parser.parseAccountList(page, function (error, accounts) {
			callback(null, form, accounts);
		});
	});
}

parser.parseCurrency = function (text) {
	var amount = Number(text.replace(/[^0-9\.]+/g, ''));
	if (text.indexOf('DR') > -1) {
		amount = -amount;
	}
	return amount;
}

parser.extractTransactionJsonArray = function (page) {
	var begin = page.indexOf('{"Transactions'),
		end = -1;
	if (begin === -1) {
		// console.error('Cannot find beginning of the transactions.');
		return null;
	} else {
		//	find the transactions block
		// console.log('  begin at ' + begin);
		var embedded = 1;
		for (var i = begin + 1; i <= page.length; ++i) {
			var c = page.charAt(i);
			switch (c) {
			case '{':
				embedded++;
				break;
			case '}':
				embedded--;
				break;
			default:
				break;
			}
			if (embedded === 0) {
				end = i + 1;
				// console.log('  end at ' + end);
				break;
			}
		}

		return JSON.parse(page.substring(begin, end)).Transactions;
	}
};

// Transaction format
// {
// 	timestamp,
// 	date,
// 	description,
// 	amount,
// 	balance,
// 	trancode,
// 	receiptnumber
// }

parser.parseJsonToTransaction = function (json) {
	var transaction = {};

	//  try parse the date from 'Sort.Text' first
	var dateTag = json.Date.Sort[1];
	var t = moment.utc(dateTag, 'YYYYMMDDHHmmssSSS');
	if (!t.isValid()) {
		//  try parse the date from 'Date.Text' if previous failed
		t = moment.utc(json.Date.Text, 'DD MMM YYYY');
		//	use sort order to distinguish different transactions.
		if (!string(dateTag).isEmpty() && !isNaN(+dateTag)) {
			t.millisecond(+dateTag);
		}
	}
	transaction.timestamp = t.valueOf();

	transaction.date = t.toISOString();
	transaction.description = json.Description.Text;
	transaction.amount = parser.parseCurrency(json.Amount.Text);
	transaction.balance = parser.parseCurrency(json.Balance.Text);
	transaction.trancode = json.TranCode.Text;
	transaction.receiptnumber = string(json.ReceiptNumber.Text).isEmpty() ? '' :
		json.ReceiptNumber.Text;

	return transaction;
}

parser.parseTransactions = function (page, callback) {
	var transactions = [];
	var jsonArray = parser.extractTransactionJsonArray(page);
	if (jsonArray !== null) {
		for (var index in jsonArray) {
			var t = jsonArray[index];
			var transaction = parser.parseJsonToTransaction(t);
			transactions.push(transaction);
		}

		callback(null, transactions);
	} else {
		callback('ERROR: Cannot find transaction section.');
	}
}

// AccountWithKeys
// {
// 	nickname,
// 	number,
// 	key
// }
parser.parseAccountKeys = function (page, callback) {
	var accounts = [];
	var $ = cheerio.load(page);
	$('select').each(function (i, e) {
		$(e).find('option').each(function (i, e) {
			var account = {};

			var titles = $(e).html().split('|', 2);
			if (titles.length > 1) {
				account.nickname = titles[0].trim();
				account.number = titles[1].replace(/\s+/g, '');
			}
			account.key = $(e).attr('value');

			if (account.key.length > 0 && titles.length > 1) {
				accounts.push(account);
			}
		});
	});

	callback(null, accounts);
}

parser.parseTransactionPage = function (page, callback) {
	parser.parseForm(page, function (error, form) {
		if (error !== null) {
			callback(error);
		} else {
			parser.parseTransactions(page, function (error, transactions) {
				if (error !== null) {
					callback(error);
				} else {
					parser.parseAccountKeys(page, function (error, keys) {
						if (error !== null) {
							callback(error);
						} else {
							callback(null, form, transactions, keys);
						}
					});
				}
			});
		}
	});
};