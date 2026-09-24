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

  // Contact form: opens the visitor's email client with the enquiry pre-filled.
  var form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var d = new FormData(form);
      var subject = "Enquiry: " + (d.get("interest") || "Free automation assessment") + " — " + d.get("company");
      var body = [
        "Name: " + d.get("name"),
        "Company: " + d.get("company"),
        "Email: " + d.get("email"),
        "Phone: " + (d.get("phone") || "-"),
        "Interested in: " + d.get("interest"),
        "",
        d.get("message")
      ].join("\n");
      window.location.href = "mailto:admin@nextgentechnologys.com?subject=" +
        encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      var status = document.getElementById("form-status");
      if (status) status.textContent = "Opening your email app — just press send and we'll get back to you within one business day.";
    });
  }
})();
