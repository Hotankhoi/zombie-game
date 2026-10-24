// Keep the isolated map preview out of A's application entry point.
if (new URLSearchParams(window.location.search).get('map') === '1') {
  void import('./preview');
} else {
  void import('./main');
}
