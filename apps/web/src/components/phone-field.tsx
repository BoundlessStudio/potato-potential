"use client";
import { useState, type FocusEventHandler } from "react";
import PhoneInput, {
  formatPhoneNumberIntl,
  getCountryCallingCode,
  type Country,
} from "react-phone-number-input";
import { phoneSchema } from "@boundless/shared";

type CountrySelectProps = {
  value?: Country;
  onChange: (value?: Country) => void;
  options: { value?: Country; label: string; divider?: boolean }[];
  disabled?: boolean;
  readOnly?: boolean;
  onFocus?: FocusEventHandler<HTMLSelectElement>;
  onBlur?: FocusEventHandler<HTMLSelectElement>;
};
function CountrySelect({
  value,
  onChange,
  options,
  disabled,
  readOnly,
  onFocus,
  onBlur,
}: CountrySelectProps) {
  return (
    <select
      aria-label="Phone country"
      className="phone-country"
      value={value || "ZZ"}
      onChange={(event) =>
        onChange(
          event.target.value === "ZZ"
            ? undefined
            : (event.target.value as Country),
        )
      }
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={disabled || readOnly}
    >
      {options
        .filter((option) => !option.divider)
        .map((option) => (
          <option key={option.value || "ZZ"} value={option.value || "ZZ"}>
            {option.label}
            {option.value ? ` (+${getCountryCallingCode(option.value)})` : ""}
          </option>
        ))}
    </select>
  );
}

export function PhoneField({
  value,
  onChange,
  submitted,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  submitted: boolean;
  disabled?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const [country, setCountry] = useState<Country | undefined>("CA");
  const validation = phoneSchema.safeParse(value);
  const error = (touched || submitted) && !validation.success;
  return (
    <div className="phone-field">
      <label htmlFor="owner-phone">Your mobile number</label>
      <PhoneInput
        id="owner-phone"
        name="phone"
        defaultCountry="CA"
        countryOptionsOrder={["CA", "US", "GB", "AU", "…", "🌐"]}
        countrySelectComponent={CountrySelect}
        onCountryChange={setCountry}
        value={value || undefined}
        onChange={(number) => onChange(number || "")}
        onBlur={() => setTouched(true)}
        onInvalid={() => setTouched(true)}
        autoComplete="tel"
        inputMode="tel"
        required
        disabled={disabled}
        className={`phone-control${error ? " phone-control-invalid" : ""}`}
        aria-invalid={error}
        aria-describedby={`phone-hint phone-verification-hint${error ? " phone-error" : ""}`}
        placeholder={
          country === "CA" || country === "US"
            ? "(416) 555-0123"
            : "Type or paste your number"
        }
      />
      {error && (
        <p id="phone-error" className="phone-error" role="alert">
          {value
            ? "Enter a complete mobile number for the selected country."
            : "Enter your mobile number."}
        </p>
      )}
      <small id="phone-hint">
        {validation.success
          ? `We’ll use ${formatPhoneNumberIntl(validation.data)}.`
          : "Choose your country, then type or paste your number."}
      </small>
      <small id="phone-verification-hint">
        You’ll confirm it from your phone before messaging is enabled.
      </small>
    </div>
  );
}
