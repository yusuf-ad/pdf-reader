// Sunucu bileşeninden (layout) de okunabilsin diye "use client" dosyasından ayrı.
export const LANG_STORAGE_KEY = "pdf-reader:lang";

/** Sayfa boyanmadan önce <html lang> ayarlanır (layout'taki inline script). */
export const langScript = `try{var l=localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});if(l!=="en"&&l!=="tr")l=(navigator.languages||[]).some(function(x){return x.toLowerCase().indexOf("tr")===0})?"tr":"en";document.documentElement.lang=l}catch(e){}`;
