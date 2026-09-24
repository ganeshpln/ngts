// NextGen Technology Solutions — site interactions
(function () {
  document.documentElement.classList.remove("no-js");

  // Sticky header shadow
  var header = document.querySelector(".site-header");
  var onScroll = function () {
    if (header) header.classList.toggle("scrolled", window.scrollY > 10);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mobile nav
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Reveal on scroll
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }

  // Footer year
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Contact form: submits to Formspree in the background and reports the result inline.
  var form = document.getElementById("contact-form");
  if (form) {
    var status = document.getElementById("form-status");
    var button = document.getElementById("form-submit");
    var setStatus = function (text, isError) {
      status.textContent = text;
      status.classList.toggle("is-error", !!isError);
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;

      button.disabled = true;
      setStatus("Sending your enquiry…");

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      }).then(function (res) {
        if (res.ok) {
          form.reset();
          setStatus("Thank you! Your enquiry has been sent — we'll get back to you within one business day.");
          return;
        }
        return res.json().catch(function () { return {}; }).then(function (data) {
          var msg = data && data.errors ? data.errors.map(function (x) { return x.message; }).join(", ") : "";
          throw new Error(msg);
        });
      }).catch(function (err) {
        setStatus("Sorry, your enquiry couldn't be sent" + (err && err.message ? " (" + err.message + ")" : "") +
          ". Please email admin@nextgentechnologys.com or call +91 96770 10170.", true);
      }).then(function () {
        button.disabled = false;
      });
    });
  }
})();
