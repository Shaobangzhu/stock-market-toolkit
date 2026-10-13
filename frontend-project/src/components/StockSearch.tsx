import { useState } from 'react';
import { Button, Input } from 'antd';
import { ArrowRightOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { normalizeStockSymbol } from '../api/stocks';

export function StockSearch() {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const navigate = useNavigate();

  function openSymbol(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = normalizeStockSymbol(value);
    if (!symbol) { setInvalid(true); return; }
    setInvalid(false);
    navigate(`/stocks/${encodeURIComponent(symbol)}`);
    setValue('');
  }

  return (
    <form className="stock-search" role="search" onSubmit={openSymbol}>
      <Input
        id="global-stock-search"
        aria-label="Open stock symbol"
        aria-invalid={invalid}
        placeholder="Open a ticker symbol…"
        prefix={<SearchOutlined aria-hidden="true" />}
        value={value}
        maxLength={32}
        onChange={(event) => { setValue(event.target.value); setInvalid(false); }}
      />
      <Button htmlType="submit" type="primary" aria-label="Open stock research" icon={<ArrowRightOutlined />} />
      {invalid && <span className="stock-search__error" role="alert">Enter a valid ticker symbol.</span>}
    </form>
  );
}
