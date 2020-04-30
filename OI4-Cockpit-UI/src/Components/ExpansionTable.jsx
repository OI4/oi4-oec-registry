import React from 'react';

import { withStyles } from '@material-ui/core/styles';

import namur0 from '../Images/namur_0.png';
import namur1 from '../Images/namur_1.png';
import namur2 from '../Images/namur_2.png';
import namur3 from '../Images/namur_3.png';
import namur4 from '../Images/namur_4.png';

import PropTypes from 'prop-types';

import MaterialTable from 'material-table';

import {
  Typography,
  ExpansionPanel,
  ExpansionPanelDetails,
  ExpansionPanelSummary,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Collapse,
  IconButton,
  Tooltip,
  Snackbar,
  TextField,
  InputAdornment,
  Grid,
  Box,
  TableContainer
} from '@material-ui/core';

import {
  ExpandMore,
  ExpandLess,
  Delete,
  FileCopy,
  Close,
  Search,
} from '@material-ui/icons';

import ExpansionTableDetail from './ExpansionTableDetail';

const styles = theme => ({
  table: {
  },
  tableInside: {
    padding: theme.spacing(2),
    fontWeight: 100,
    minHeight: '100vh',
    fontSize: 'calc(5px + 1vmin)',
  },
  tableWrap: {
    overflow: 'auto',
    flexDirection: 'column', // ExpansionPanelDetail is a flex container!
  },
});

class ExpansionTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      expandedLookup: {},
      namurLookup: {
        NORMAL_0: namur0,
        FAILURE_1: namur1,
        CHECK_FUNCTION_2: namur2,
        OFF_SPEC_3: namur3,
        MAINTENANCE_REQUIRED_4: namur4,
      },
      rowOpacity: '1.0',
      tableName: `${this.props.lookupType.substring(0, 1).toUpperCase()}${this.props.lookupType.substring(1)} Table`, // First character to UpperCase, concatenate the rest
      validityLookup: {
        0: '❔',
        1: <img src={namur0} alt="Namur" height='25px' width='30px' />,
        2: <img src={namur2} alt="Namur" height='25px' width='30px' />,
        3: <img src={namur1} alt="Namur" height='25px' width='30px' />,
      },
      filterWord: '',
      filterWordEvent: '',
    };
  }

  /**
   * Main render method of the ExpansionTable
   * @memberof OI4Base
   */
  render() {
    const { classes } = this.props;
    // Filter assetList to be displayed
    const filteredAssets = Object.keys(this.props.assetLookup) // TODO: Maybe get this to another place?
      .filter((key) => {
        if (this.state.filterWord === '') {
          return true;
        }
        for (const items of Object.keys(this.props.assetLookup[key].resources.mam)) {
          if (items === 'Manufacturer') {
            if (this.props.assetLookup[key].resources.mam[items].Text.includes(this.state.filterWord)) {
              return true;
            }
          }
          if (typeof this.props.assetLookup[key].resources.mam[items] === 'string') {
            if (this.props.assetLookup[key].resources.mam[items].includes(this.state.filterWord)) {
              return true;
            }
          }
        }
        return false;
      })
      .reduce((obj, key) => {
        obj[key] = this.props.assetLookup[key];
        return obj;
      }, {});
    return (
      <>
        <ExpansionPanel>
          <ExpansionPanelSummary expandIcon={<ExpandMore />}>
            <div>{this.state.tableName}: ({Object.keys(this.props.assetLookup).length} entries)</div>
            <TextField
              id='filterText'
              value={this.state.filterWord}
              onChange={this.handleFilterChange.bind(this)}
              onClick={(ev) => ev.stopPropagation()}
              onFocus={(ev) => ev.stopPropagation()}
              InputProps={{
                endAdornment: (
                  <InputAdornment position='end'>
                    <Search />
                  </InputAdornment>
                ),
              }}
              placeholder='Filtertext'
              style={{ marginLeft: 'auto', minWidth: '5%', maxWidth: '22%' }}
              color='secondary'
            />
          </ExpansionPanelSummary>
          <ExpansionPanelDetails className={classes.tableWrap}>
            <Table className={classes.table}>
              <TableHead>
                <TableRow>
                  <TableCell>Manufacturer</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>DeviceClass</TableCell>
                  <TableCell>SerialNumber</TableCell>
                  <TableCell align="right">Health</TableCell>
                  <TableCell align="right">Last Message</TableCell>
                  <TableCell align="right">Conformity</TableCell>
                  <TableCell align="right">Expand</TableCell>
                  {this.props.expertMode ? <TableCell align='right'>Delete</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.keys(filteredAssets).map((oi4Id, idx) => (
                  <React.Fragment key={`AssetTable-${oi4Id}-${idx}`}>
                    {/* {console.log((parseFloat(+(this.props.assetLookup[oi4Id].available)) + 0.5).toString())}
                    {console.log(oi4Id)} */}
                    <TableRow
                      key={`AssetTable-${oi4Id}-${idx}`}
                      hoverstyle={{ cursor: "pointer" }}
                      style={{ opacity: (parseFloat(+(this.props.assetLookup[oi4Id].available)) + 0.5).toString() }}
                    // FIXME: A bit hacky: we get a bool from availability. Opacity over 1.0 does not hurt, so we add 0.5 to it. false(0) will result in 0.5
                    // and true(1) will result in 1.5 To parse a bool into a float, we need to make it an integer, this is achieved by + operator
                    // (nodejs type inference) then parse it to float, add it together and convert it to a string
                    >
                      <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'mam').Manufacturer.Text}</TableCell>
                      <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'mam').Model.Text}</TableCell>
                      <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'mam').DeviceClass}</TableCell>
                      <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'mam').SerialNumber}</TableCell>
                      <TableCell align="right">{this.displayNamurHealth(this.getHealth(oi4Id, 'application'))}</TableCell>
                      <TableCell align="right">{this.props.assetLookup[oi4Id].lastMessage}</TableCell>
                      <TableCell align="right">
                        <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size='small'
                          color='default'
                          onClick={() => {
                            const expandedLookupCopy = JSON.parse(JSON.stringify(this.state.expandedLookup));
                            if (oi4Id in expandedLookupCopy) {
                              expandedLookupCopy[oi4Id] = !(expandedLookupCopy[oi4Id]);
                            } else {
                              expandedLookupCopy[oi4Id] = true;
                            }
                            this.setState({ expandedLookup: expandedLookupCopy });
                          }}
                        >
                          {this.displayTableExpansion(oi4Id)}
                        </IconButton>
                      </TableCell>
                      {this.props.expertMode ? <TableCell align="right">
                        <IconButton
                          size='small'
                          color='default'
                          onClick={(evt) => {
                            evt.preventDefault();
                            this.props.clearAsset(oi4Id);
                          }}
                        >
                          <Delete />
                        </IconButton>
                      </TableCell> : null}
                    </TableRow>
                    <TableRow key={`AssetTableDetail-${oi4Id}-${idx}`}>
                      <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                        <Collapse
                          className={classes.tableInside}
                          in={this.state.expandedLookup[oi4Id]}
                          timeout='auto'
                          unmountOnExit
                        >
                          <Grid container>
                            <Grid item xs={12}>
                              <ExpansionTableDetail
                                asset={this.props.assetLookup[oi4Id]}
                                conformityLookup={this.props.conformityLookup}
                                expertMode={this.props.expertMode}
                                oi4Id={oi4Id}
                                assetLookup={this.props.assetLookup}
                                updateConformity={this.updateConformity.bind(this)}
                                getResourceObject={this.getResourceObject.bind(this)}
                                lookupType={this.props.lookupType}
                                fontColor={this.props.fontColor}
                                updatingConformity={this.props.updatingConformity}
                              />
                            </Grid>
                            {/* <Grid item xs={12}>
                              <h3>{`Last ${this.props.assetLookup[oi4Id].eventList.length} Events:`}</h3>
                              <TextField
                                id='filterText'
                                value={this.state.filterWordEvent}
                                onChange={this.handleFilterEventChange.bind(this)}
                                onClick={(ev) => ev.stopPropagation()}
                                onFocus={(ev) => ev.stopPropagation()}
                                InputProps={{
                                  endAdornment: (
                                    <InputAdornment position='end'>
                                      <Search />
                                    </InputAdornment>
                                  ),
                                }}
                                placeholder='Filtertext'
                                style={{ marginLeft: '10px', minWidth: '80px', maxWidth: '200px' }}
                                color='secondary'
                              />
                            </Grid> */}
                            <Grid item xs={12}>
                              {this.displayLocalEvents(this.props.assetLookup[oi4Id].eventList.filter((item) => {
                                if (this.state.filterWordEvent === '') return true;
                                if (item.Tag.includes(this.state.filterWordEvent)) return true;
                                if (item.description.includes(this.state.filterWordEvent)) return true;
                                if (item.number.toString().includes(this.state.filterWordEvent)) return true;
                                if (JSON.stringify(item.payload).includes(this.state.filterWordEvent)) return true;
                                return false;
                              }))}
                            </Grid>
                          </Grid>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </ExpansionPanelDetails>
        </ExpansionPanel>
      </>
    );
  }

  /**
   * Checks whether the resource is available in the lookup and returns it
   * @param {string} oi4Id - The oi4Id that si to be looked up
   * @param {string} resource - The resource that will be displayed if the lookup succeedes
   * @returns The requested resource, if found. An error, if not
   * @memberof ExpansionTableDetail
   */
  getResourceObject(oi4Id, resource) {
    const lookup = this.props.assetLookup;
    if (resource in lookup[oi4Id].resources) {
      return lookup[oi4Id].resources[resource];
    }
    return 'Error - getResourceObject: resource not found in lookup';
  }

  /**
   * Checks if the health property of the payload is available and prints it, if yes.
   * @param {string} oi4Id
   * @param {string} [type='application']
   * @returns The actual health object of the payload, if it finds anything, an error string, if it does not
   * @memberof ExpansionTable
   */
  getHealth(oi4Id, type = 'application') {
    let lookup;
    if (type === 'application') {
      lookup = this.props.assetLookup;
    } else {
      return 'wrong type selected';
    }
    if ('health' in lookup[oi4Id].resources) {
      if ('health' in lookup[oi4Id].resources.health) {
        return lookup[oi4Id].resources.health.health;
      }
    }
    return 'Error - getHealth: health string not found in lookup';
  }

  /**
   * Checks the state of the expansion of the table and returns the corresponding icon
   * @param {string} oi4Id
   * @returns ExpandMore-Icon, if the table is not expanded ; ExpandLess-Icon, if it is expanded
   * @memberof ExpansionTable
   */
  displayTableExpansion(oi4Id) {
    if (!this.state.expandedLookup[oi4Id]) {
      return <ExpandMore />;
    } else {
      return <ExpandLess />;
    }
  }

  /**
   * Displays the validity result of the overall conformity in Emoji-Form
   * @param {string} oi4Id
   * @returns An emoji, if the item is available, 'wait...' string, if it is not
   * @memberof ExpansionTable
   */
  displayConformityHeader(oi4Id) {
    if (this.props.conformityLookup[oi4Id]) {
      return this.state.validityLookup[this.props.conformityLookup[oi4Id].validity];
    } else {
      return 'Wait...';
    }
  }

  /**
   * Displays the received namur health as the corresponding image in the header
   * @param {string} status The healthstatus according to NAMUR spec
   * @param {string} [height='25']
   * @param {string} [width='30']
   * @returns An image of the NAMUR health, if the status is valid. 'Undefined NamurHealth', if it is not
   * @memberof ExpansionTable
   */
  displayNamurHealth(status, height = '25', width = '30') {
    if (!(status in this.state.namurLookup)) {
      return 'Undefined NamurHealth';
    } else {
      return <img src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
    }
  }

  /**
   * Displays the Events / Events coming from either global or local data sources
   * @param {array} eventArray - an array of the last few events
   */
  displayLocalEvents(eventArray) {
    let newArray = [];
    for (const items of eventArray) {
      newArray.push({
        number: items.number,
        description: items.description,
        payload: JSON.stringify(items.payload),
      });
    }
    if (Array.isArray(eventArray)) {
      
      return (<MaterialTable
        columns={[
          { title: "ErrorCode", field: "number" },
          { title: "Description", field: "description" },
          { title: 'Payload', field: 'payload' }
        ]}
        data={newArray}
        title={`Last ${eventArray.length} Events:`}
      />);

      // return <Grid item xs={3}><Table style={{ width: 'auto', tableLayout: 'auto' }}>
      //   <TableHead>
      //     <TableRow>
      //       <TableCell>
      //         <span style={{ marginRight: '1%' }}>
      //           <Tooltip title="Copy to clipboard">
      //             <IconButton
      //               size='small'
      //               color='default'
      //               onClick={() => {
      //                 navigator.clipboard.writeText(JSON.stringify(eventArray, null, 2)).then(() => {
      //                   this.setState({ copySnackOpen: true });
      //                 });
      //               }}
      //             >
      //               <FileCopy />
      //             </IconButton>
      //           </Tooltip>
      //           <Snackbar
      //             open={this.state.copySnackOpen}
      //             anchorOrigin={{
      //               vertical: 'bottom',
      //               horizontal: 'center',
      //             }}
      //             onClose={() => { this.setState({ copySnackOpen: false }) }}
      //             autoHideDuration={5000}
      //             message='Saved Local Events to clipboard'
      //             action={
      //               <>
      //                 <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
      //                   <Close fontSize='small' />
      //                 </IconButton>
      //               </>
      //             }
      //           />
      //         </span>
      //         ErrorCode</TableCell>
      //       <TableCell>Description</TableCell>
      //       <TableCell>Payload</TableCell>
      //     </TableRow>
      //   </TableHead>
      //   <TableBody>
      //     {
      //       eventArray.map((events, idx) => {
      //         return <TableRow key={`LocalEvents-${idx}`}>
      //           <TableCell>{events.number}</TableCell>
      //           <TableCell component="th" scope="row" style={{ width: '35%' }}>{events.description}</TableCell>
      //           <TableCell>{JSON.stringify(events.payload)}</TableCell>
      //         </TableRow>;
      //       })
      //     }
      //   </TableBody>
      // </Table></Grid>;
    }
  }

  /**
   * Callback handler in order to update the conformity of a buttonpress.
   * Calls the parent callback to handle the function.
   * @param {string} fullTopic
   * @param {string} oi4Id
   * @memberof ExpansionTable
   */
  updateConformity(fullTopic, oi4Id) {
    console.log(`Updating Conformity for ${fullTopic} with oi4Id: ${oi4Id} FROM EXPANSTIONTABLE COMPONENT`);
    this.props.updateConformity(fullTopic, oi4Id);
  }

  handleFilterChange(ev) {
    this.setState({ filterWord: ev.target.value });
  }

  handleFilterEventChange(ev) {
    this.setState({ filterWordEvent: ev.target.value });
  }
}

ExpansionTable.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(ExpansionTable);
