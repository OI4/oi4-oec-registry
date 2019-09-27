import React from 'react';
import ReactDOM from 'react-dom';
import OI4Base from './app.jsx';

it('renders without crashing', () => {
  const div = document.createElement('div');
  ReactDOM.render(<OI4Base />, div);
  ReactDOM.unmountComponentAtNode(div);
});
