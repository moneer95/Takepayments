let gateway = require('./gateway.js');
let testData = {'aA': 'second', 'a[': 'first', 'aB': 'third' };

function phpCompatibleSort(a, b) {

	let pos = 0;
	let rtn;

	do {
		// codePointAt helpfully returns undefined if pos > length + 1
		achr = a.codePointAt(pos);
		bchr = b.codePointAt(pos);

		// Swap [ for 0.
		if (achr == '['.codePointAt(0)) {
			achr = '0'.codePointAt(0);
		}
		if (bchr == '['.codePointAt(0)) {
			bchr = '0'.codePointAt(0);
		}

		if (achr == undefined) {  //We don't need to check b at all.
			return -1
		}
		if (bchr == undefined) {
			return 1
		}

		rtn = achr - bchr;
		pos++;
	} while (rtn == 0)

	return rtn;
	}


function phpCompatibleSortTests() {

	g = ['a', 'c', 'b']
	console.log(g.sort(phpCompatibleSort));

	g = ['a', 'aaa', 'aa']
	console.log(g.sort(phpCompatibleSort));

	g = ['acc', 'ab', 'aa', 'ac', 'aaa']
	console.log(g.sort(phpCompatibleSort));

	g = ['aa', 'ab', 'aA', 'a[']
	console.log(g.sort(phpCompatibleSort));

}

phpCompatibleSortTests();