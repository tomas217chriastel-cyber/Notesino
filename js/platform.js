/* ---------- Platform detection ----------
   Decides two independent things:
   1. native vs web   — are we running inside the Capacitor Android/iOS
      shell, or in a normal mobile/desktop browser?
   2. touch vs pointer — does this device's primary input make sense as
      touch controls (bigger hit targets, no hover, drag handles instead
      of hover-revealed buttons) or desktop mouse controls (hover states,
      right-click, smaller chrome)?
   Everything else in the app reads `Platform.controlMode` instead of
   re-sniffing the UA, so the touch/desktop split stays in one place. */
(function (global) {
  var capacitor = global.Capacitor;
  var isNative = !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform());
  var nativePlatform = isNative ? capacitor.getPlatform() : null; // 'android' | 'ios' | null

  var coarsePointer = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
  var hasTouch = 'ontouchstart' in global || (navigator.maxTouchPoints || 0) > 0;
  var isTouch = isNative || coarsePointer || hasTouch;

  var controlMode = isTouch ? 'touch' : 'desktop';
  document.documentElement.setAttribute('data-platform', nativePlatform || (isTouch ? 'touch-web' : 'desktop-web'));
  document.documentElement.setAttribute('data-controls', controlMode);

  global.Platform = {
    isNative: isNative,
    nativePlatform: nativePlatform, // 'android' | 'ios' | null
    isTouch: isTouch,
    controlMode: controlMode, // 'touch' | 'desktop'
    isAndroid: nativePlatform === 'android',
    isIOS: nativePlatform === 'ios'
  };
})(window);
