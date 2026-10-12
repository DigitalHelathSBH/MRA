// radio / checkbox แบบวงกลมมีเอฟเฟกต์กระเด็น (filter #goo อยู่ใน RootLayout)
export default function FancyCheck({ id, type = "radio", label, ...props }) {
  return (
    <label className="fc" htmlFor={id}>
      <span className="cbx">
        <input id={id} type={type} {...props} />
        <span className="cbx-splash" />
        <svg width="15" height="14" viewBox="0 0 15 14" fill="none" aria-hidden="true">
          <path d="M2 8.36364L6.23077 12L13 2" />
        </svg>
      </span>
      <span className="fc-label">{label}</span>
    </label>
  );
}
