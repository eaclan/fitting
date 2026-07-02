// search.js — Türkçe karakter toleranslı normalizasyon ve arama.
// "corba" yazınca "Çorba" bulunmalı; "ıspanak"/"ispanak"/"İSPANAK" hepsi eşleşmeli.

(function (global) {
  'use strict';

  // Metni aramaya uygun sade forma indirger:
  //  - küçük harf (Türkçe locale)
  //  - Türkçe özel harfleri ASCII karşılıklarına indirger (ç→c, ş→s, ı/İ→i ...)
  //  - kalan aksanları (NFD) temizler
  //  - fazla boşlukları sadeleştirir
  function normalize(s) {
    if (s == null) return '';
    return String(s)
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/â/g, 'a')
      .replace(/î/g, 'i')
      .replace(/û/g, 'u')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // foods dizisinde arama yapar. Skorlama:
  //   tam eşleşme > baştan eşleşme > kelime başı eşleşme > içinde geçme
  // Boş sorgu → boş liste (çağıran taraf sık kullanılanları gösterir).
  function ara(foods, sorgu, limit = 30) {
    const q = normalize(sorgu);
    if (!q) return [];
    const kelimeler = q.split(' ').filter(Boolean);

    const sonuc = [];
    for (const f of foods) {
      const hedef = f.arama || normalize(f.ad);
      // Tüm sorgu kelimeleri hedefte geçmeli (AND).
      let hepsiVar = true;
      for (const k of kelimeler) {
        if (!hedef.includes(k)) {
          hepsiVar = false;
          break;
        }
      }
      if (!hepsiVar) continue;

      let skor = 0;
      if (hedef === q) skor = 100;
      else if (hedef.startsWith(q)) skor = 80;
      else if (hedef.split(' ').some((w) => w.startsWith(kelimeler[0]))) skor = 60;
      else skor = 40;
      // Kısa adlar biraz öne çıksın (daha alakalı).
      skor -= Math.min(hedef.length, 40) * 0.1;
      sonuc.push({ f, skor });
    }
    sonuc.sort((a, b) => b.skor - a.skor);
    return sonuc.slice(0, limit).map((x) => x.f);
  }

  global.Search = { normalize, ara };
})(window);
