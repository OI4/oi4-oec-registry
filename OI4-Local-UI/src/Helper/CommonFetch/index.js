export class CommonFetch {
  constructor(mode = 'fetch', address, port) {
    this.mode = mode;
    this.http = null;
    this.address = address;
    this.port = port;
    if (mode === 'cockpit') {
      const cockpitEndpoint = {
        address: this.address,
        port: parseInt(this.port, 10),
      };
      this.http = cockpit.http(cockpitEndpoint); // eslint-disable-line no-undef
      console.log('Cockpit selected');
    } else if (mode === 'fetch') {
      console.log('Fetch selected');
    } else {
      console.log('Error: No match selected');
    }
  }

  get(url) {
    if (this.mode === 'fetch') {
      return new Promise((resolve, reject) => {
        fetch(`http://${this.address}:${this.port}${url}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'text/plain',
          },
        })
        .then(resp => {
          resolve(resp.text());
        });
      });
    } else if (this.mode === 'cockpit') {
      return this.http.get(url);
    }
  }

  delete(url) {
    if (this.mode === 'fetch') {
      return new Promise((resolve, reject) => {
        fetch(`http://${this.address}:${this.port}${url}`, {
          method: 'DELETE',
        })
        .then(resp => {
          resolve(resp.text());
        });
      });
    } else if (this.mode === 'cockpit') {
      return this.http.delete(url);
    }
  }
}
