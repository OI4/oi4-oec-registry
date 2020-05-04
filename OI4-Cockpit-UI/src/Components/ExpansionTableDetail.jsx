import React from 'react';

import { withStyles } from '@material-ui/core/styles';

import namur_normal_0 from '../Images/namur_normal_0.png';
import namur_failure_1 from '../Images/namur_failure_1.png';
import namur_check_function_2 from '../Images/namur_check_function_2.png';
import namur_off_spec_3 from '../Images/namur_off_spec_3.png';
import namur_maintenance_required_4 from '../Images/namur_maintenance_required_4.png';

import PropTypes from 'prop-types';

import {
  Paper,
  IconButton,
  Grid,
  CircularProgress,
  Tooltip,
  Snackbar
} from '@material-ui/core';

import {
  Refresh,
  FileCopy,
  Close,
} from '@material-ui/icons';

const styles = theme => ({
  paper: {
    padding: theme.spacing(1),
    marginTop: theme.spacing(2),
    width: '85%',
    overflowX: 'auto',
    marginBottom: theme.spacing(2),
  },
});

/**
 * This component serves as the DetailView of the Table that displays the registered enties
 * Here, the information about the Conformity, Health, Mam and Events are displayed in a more detailed view.
 * It essentially is a grid, consisting of multiple papers with different information.
 * @class ExpansionTableDetail
 * @extends {React.Component}
 */
class ExpansionTableDetail extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      expandedLookup: {},
      // maps the different Namur-States to their official images
      namurLookup: {
        NORMAL_0: namur_normal_0,
        FAILURE_1: namur_failure_1,
        CHECK_FUNCTION_2: namur_check_function_2,
        OFF_SPEC_3: namur_off_spec_3,
        MAINTENANCE_REQUIRED_4: namur_maintenance_required_4,
      },
      // Maps the validity numbers to emojis
      validityLookup: {
        0: '❔',
        1: <img style={{ verticalAlign: 'middle' }} src={namur_normal_0} alt="Namur" height='20px' width='20px' />,
        2: <img style={{ verticalAlign: 'middle' }} src={namur_off_spec_3} alt="Namur" height='20px' width='20px' />,
        3: <img style={{ verticalAlign: 'middle' }} src={namur_failure_1} alt="Namur" height='20px' width='20px' />,
      },
      copySnackOpen: false,
    };
    // A list of mandatory resources so we can decide which ones we display
    this.mandatoryResource = {
      application: ['health', 'license', 'licenseText', 'mam', 'profile', 'publicationList'],
      device: ['health', 'mam', 'profile'],
    };
  }

  /**
   * Main render method of the ExpansionTableDetail
   * @memberof OI4Base
   */
  render() {
    const { classes } = this.props;
    return (
        <Grid container justify='space-evenly'>
          <Grid item xs={6}>
            <h3>Detailed MasterAssetModel:
              <span style={{ marginRight: '1%' }}>
                <Tooltip title="Copy to clipboard">
                  <IconButton
                    size='small'
                    color='default'
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(this.props.asset.resources.mam, null, 2)).then(() => {
                        this.setState({ copySnackOpen: true });
                      });
                    }}
                  >
                    <FileCopy />
                  </IconButton>
                </Tooltip>
                <Snackbar
                  open={this.state.copySnackOpen}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'center',
                  }}
                  onClose={() => { this.setState({ copySnackOpen: false }) }}
                  autoHideDuration={5000}
                  message='Saved MAM to clipboard'
                  action={
                    <>
                    <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
                      <Close fontSize='small' />
                    </IconButton>
                    </>
                  }
                />
              </span>
            </h3>
            <Paper className={classes.paper}>
              {this.ownJsonViewer(this.props.asset.resources.mam)}
            </Paper>
          </Grid>
          {this.props.expertMode ? <Grid item xs>
            <h3>Detailed Profile (Debugging):</h3>
            <Paper className={classes.paper}>
              {this.ownJsonViewer(this.props.asset.resources.profile)}
            </Paper>
          </Grid>
          : null}
          <Grid item xs>
            <h3>Conformity Validation:
                <IconButton size='small' color='default' onClick={() => { this.props.updateConformity(this.props.asset.fullDevicePath, this.props.oi4Id) }}>
                <Refresh />
              </IconButton>
            </h3>
            <Paper className={classes.paper}>
              {this.displayConformity(this.convertConformityToEmoji(this.props.conformityLookup, this.props.oi4Id))}
            </Paper>
          </Grid>
          <Grid item xs>
            <h3>Detailed Health:</h3>
            <Paper className={classes.paper}>
              {this.detailedHealthViewer(this.props.getResourceObject(this.props.oi4Id, 'health'))}
            </Paper>
          </Grid>
          {this.displayOrigin(this.props.lookupType, this.props.oi4Id, classes)}
        </Grid>
    );
  }

  /**
   * Displays the originator by lookup in its assetlookup
   * If the type of lookup is "application", we don't need the Originator Paper.
   * If the type of lookup is "device", we need to display it
   * @param {string} [lookupType='application']
   * @param {string} oi4Id - The oi4Id that is to be looked up
   * @param {object} classes - The classes containen the layout for the paper element
   * @returns Paper with detailed originator paper element
   * @memberof ExpansionTableDetail
   */
  displayOrigin(lookupType = 'application', oi4Id, classes) {
    if (lookupType === 'device') {
      return <div>
        <h3>Originator:</h3>
        <Paper className={classes.paper}>
          {this.props.assetLookup[oi4Id].originator}
        </Paper>
      </div>;
    }
  }

  /**
   * Displays the current health state in Namur form via the lookup as an <img> Tag
   * @param {string} status - The health string defined in Namur format
   * @param {string} [height='25'] - The height of the resulting <img> tag
   * @param {string} [width='25'] - The width of the resulting <img> tag
   * @returns An image tag with the corresponding namur symbol.
   * @memberof ExpansionTableDetail
   */
  displayNamurHealth(status, height = '25', width = '25') {
    if (!(status in this.state.namurLookup)) {
      return "Undefined NamurHealth";
    } else {
      return <img style={{ verticalAlign: 'middle' }} src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
    }
  }

  /**
   * Displayed the entire health object in human readable form
   * @param {object} healthObject - The healthobject that is to be converted
   * @returns The helath in human readable form
   * @memberof ExpansionTableDetail
   */
  detailedHealthViewer(healthObject) {
    return <div>
      <div><span style={{ fontWeight: 'bold' }}>NE107 Status:</span>{healthObject.health}({this.displayNamurHealth(healthObject.health, 20, 20)})</div>
      <div><span style={{ fontWeight: 'bold' }}>Health state[%]:</span>{healthObject.healthState}</div>
    </div>;
  }

  /**
   * Displays a JSON-Object in a relatively simple manner by recursing over the object
   * @param {object} jsonObject - the object that is to be displayed
   * @param {number} idx - the depthLevel that we are displaying with the viewer
   */
  ownJsonViewer(jsonObject, idx = 0) {
    if (typeof jsonObject === 'object' && jsonObject !== null) {
      return Object.keys(jsonObject).map((keys) => {
        if (typeof jsonObject[keys] === 'object' && jsonObject[keys] !== null) {
          return <div key={`JsonViewer-${keys}`} style={{ marginLeft: `${(idx + 5).toString()}%` }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div key={`JsonViewer-${keys}`} style={{ marginLeft: `${(idx + 5).toString()}%` }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {jsonObject[keys].toString()}</div>;
        }
      });
    } else if (Array.isArray(jsonObject)) {
      return jsonObject.map((keys) => {
        if (typeof jsonObject[keys] === 'object' && jsonObject[keys] !== null) {
          return <div key={`JsonViewer-${keys}`} style={{ marginLeft: `${(idx + 5).toString()}%` }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div key={`JsonViewer-${keys}`} style={{ marginLeft: `${(idx + 5).toString()}%` }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {'Test'}</div>;
        }
      });
    } else {
      return <CircularProgress />;
    }
  }

  /**
   * Converts a conformity Object to a displayable fashion and displays
   * all conformity values (ok, partial, nok) in a table
   * @param {string} assetType - The type of the asset (device/application)
   * @param {object} conformityObject - The conformity object that is to be displayed
   */
  displayConformity(conformityObject, assetType = 'application') {
    if (this.props.updatingConformity) {
      return <CircularProgress />;
    } else {
      if (typeof conformityObject === 'object' && conformityObject !== null) {
        return <div>
          <b>OI4-Id Conformity: </b>{conformityObject.oi4Id}
          {
            Object.keys(conformityObject.resource).map((resources) => {
              let resourceColor = this.props.fontColor;
              let resourceWeight = 400;
              if (conformityObject.nonProfileResourceList.includes(resources)) {
                resourceColor = 'red';
              }
              if (this.mandatoryResource[assetType].includes(resources)) {
                resourceWeight = 600;
              }
              if (conformityObject.resource[resources].validityError) {
                return <div key={`Conformity-${resources}`} style={{ fontWeight: resourceWeight, color: resourceColor }}>{resources}: {conformityObject.resource[resources].validity}, Error: {conformityObject.resource[resources].validityError}</div>;
              } else {
                return <div key={`Conformity-${resources}`} style={{ fontWeight: resourceWeight, color: resourceColor }}>{resources}: {conformityObject.resource[resources].validity}</div>;
              }
            })
          }
        </div>;
      }
    }
  }

  /**
   * Converts the validity of a conformity Object to human readable emojis
   * and replaces the validity with these emoji
   * @param {object} conformityObject
   * @param {string} oi4Id
   * @returns {object} A conformity object, where the validity results are emoji instead of numbers
   * @memberof ExpansionTableDetail
   */
  convertConformityToEmoji(conformityObject, oi4Id) {
    const conformityObj = JSON.parse(JSON.stringify(conformityObject));
    const validityLookup = this.state.validityLookup;
    if (oi4Id in conformityObject) {
      conformityObj[oi4Id].oi4Id = validityLookup[conformityObject[oi4Id].oi4Id];
      conformityObj[oi4Id].validity = validityLookup[conformityObject[oi4Id].validity];
      Object.keys(conformityObject[oi4Id].resource).forEach((resource) => {
        conformityObj[oi4Id].resource[resource].validity = validityLookup[conformityObject[oi4Id].resource[resource].validity];
      });
      return conformityObj[oi4Id];
    } else {
      return 'ERROR';
    }
  }
}

ExpansionTableDetail.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(ExpansionTableDetail);
