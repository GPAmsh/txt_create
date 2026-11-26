// ADID 중복 검사 · 수치 대조 탭: 처음 열 때 엑셀 라이브러리와 도구 코드를 불러온다 (페이지 첫 로딩을 가볍게 유지)
(function () {
  var FILES = { adid: 'js/adid-check.js', qty: 'js/qty-compare.js' };
  var state = {}, lib = null;
  function load(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src;
      s.addEventListener('load', ok);
      s.addEventListener('error', function () { s.remove(); bad(new Error(src)); });
      document.body.appendChild(s);
    });
  }
  function open(name) {
    if (state[name]) return;
    state[name] = 'loading';
    var msg = document.getElementById(name + '-loading'), ui = document.getElementById(name + '-ui');
    msg.textContent = '불러오는 중…';
    lib = lib || load('tools/lib/xlsx.full.min.js');
    lib.then(function () { return load(FILES[name]); }).then(function () {
      state[name] = 'ready';
      msg.classList.add('hidden');
      ui.classList.remove('hidden');
    }).catch(function () {
      state[name] = null;
      if (typeof XLSX === 'undefined') lib = null;
      msg.textContent = '도구를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 탭을 다시 눌러 주세요.';
    });
  }
  Object.keys(FILES).forEach(function (name) {
    var b = document.querySelector('nav button[data-tab="' + name + '"]');
    if (b) b.addEventListener('click', function () { open(name); });
  });
})();
