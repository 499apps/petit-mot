/** Styles injected into web pages. Scoped to our own spans; never touches the site's elements. */
export const PAGE_CSS = `
span.pm-w[data-pm-id]{all:unset;display:inline;font:inherit;color:inherit;cursor:pointer;position:relative;border-radius:3px;
  transition:background-color .2s ease, box-shadow .2s ease;}
span.pm-w[data-pm-mode="swap"]{background:linear-gradient(180deg,transparent 58%,rgba(255,183,3,.42) 58%);
  box-shadow:inset 0 -2px 0 #3b5bdb;padding:0 1px;}
span.pm-w[data-pm-mode="swap"]:hover,span.pm-w[data-pm-mode="swap"]:focus-visible{background:rgba(255,183,3,.55);outline:none}
span.pm-w[data-pm-mode="swap"]:focus-visible{box-shadow:0 0 0 2px #3b5bdb}
span.pm-w[data-pm-mode="swap"][data-pm-peek]:hover::after,span.pm-w[data-pm-mode="swap"][data-pm-peek]:focus-visible::after{
  content:attr(data-pm-peek);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;
  font:600 13px/1.2 ui-rounded,"Nunito","Segoe UI",system-ui,sans-serif;color:#fff;background:#1f2340;padding:5px 9px;border-radius:9px;
  box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483646;pointer-events:none;letter-spacing:0;text-transform:none}
span.pm-w[data-pm-mode="hunt"]:hover{box-shadow:inset 0 -2px 0 rgba(59,91,219,.55)}
span.pm-w[data-pm-mode="hunt"][data-pm-found]{background:rgba(47,179,128,.28);box-shadow:inset 0 -2px 0 #2fb380}
span.pm-w[data-pm-mode="hunt"][data-pm-reveal]{background:rgba(255,183,3,.45);box-shadow:inset 0 -2px 0 #e08a00}
span.pm-w.pm-pulse{animation:pm-pulse 1.1s ease 3}
span.pm-w.pm-shake{animation:pm-shake .4s ease}
@keyframes pm-pulse{0%,100%{box-shadow:0 0 0 0 rgba(59,91,219,.0)}50%{box-shadow:0 0 0 6px rgba(59,91,219,.45);background:rgba(255,183,3,.6)}}
@keyframes pm-shake{0%,100%{transform:none}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
@media (prefers-reduced-motion: reduce){span.pm-w.pm-pulse,span.pm-w.pm-shake{animation:none;background:rgba(255,183,3,.6)}}
`;
