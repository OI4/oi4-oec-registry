export class CommonFetch {
    constructor(address) {
        this.address = address;
    }

    get(path) {
            return new Promise((resolve, reject) => {
                fetch(`${this.address}${path}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'text/plain',
                    },
                })
                    .then(resp => {
                        if (resp.status === 404 || resp.status === 500) {
                            reject(new Error(`REST returned ${resp.status}`));
                        }
                        resolve(resp.text());
                    })
                    .catch(err => {
                        reject(err);
                    });
            });
    }

    delete(path) {
            return new Promise((resolve, reject) => {
                fetch(`${this.address}${path}`, {
                    method: 'DELETE',
                })
                    .then(resp => {
                        resolve(resp.text());
                    })
                    .catch(err => {
                        reject(err);
                    });
            });

    }

    put(path, body) {
            return new Promise((resolve, reject) => {
                fetch(`${this.address}${path}`, {
                    method: 'PUT',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: body,
                })
                    .then(resp => {
                        resolve(resp.text());
                    })
                    .catch(err => {
                        reject(err);
                    });
            });
    }
}
