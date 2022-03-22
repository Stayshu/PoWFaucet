import { IFaucetConfig } from '../common/IFaucetConfig';
import { PoWClient } from '../common/PoWClient';
import React, { ReactElement } from 'react';
import { Button, Modal } from 'react-bootstrap';
import HCaptcha from "@hcaptcha/react-hcaptcha";

import './PoWCaptcha.css'
import { PoWSession } from '../common/PoWSession';
import { PoWMinerStatus } from './PoWMinerStatus';
import { PoWMiner } from '../common/PoWMiner';
import { renderDate } from '../utils/DateUtils';
import { weiToEth } from '../utils/ConvertHelpers';
import { IPoWClaimDialogReward, PoWClaimDialog } from './PoWClaimDialog';

export interface IPoWCaptchaProps {
  powApiUrl: string;
  minerSrc: string;
}

enum PoWCaptchaMiningStatus {
  IDLE = 0,
  STARTING = 1,
  RUNNING = 2,
  INTERRUPTED = 3,
  STOPPING = 4
};

export interface IStatusDialog {
  title: string;
  body: ReactElement;
  closeButton?: {
    caption: string;
  },
  applyButton?: {
    caption: string;
    applyFn: () => void,
  },
}

export interface IPoWCaptchaState {
  initializing: boolean;
  faucetConfig: IFaucetConfig;
  targetAddr: string;
  requestCaptcha: boolean;
  captchaToken: string;
  miningStatus: PoWCaptchaMiningStatus;
  isClaimable: boolean;
  statusDialog: IStatusDialog;
  statusMessage: string;
  showRestoreSessionDialog: boolean;
  showClaimRewardDialog: IPoWClaimDialogReward;
}

export class PoWCaptcha extends React.PureComponent<IPoWCaptchaProps, IPoWCaptchaState> {
  private powClient: PoWClient;
  private powSession: PoWSession;
  private hcapControl: HCaptcha;
  private powSessionUpdateListener: (() => void);
  private powSessionKilledListener: ((reason: string) => void);

  constructor(props: IPoWCaptchaProps, state: IPoWCaptchaState) {
    super(props);

    this.powClient = new PoWClient({
      powApiUrl: props.powApiUrl,
    });
    this.powClient.on("open", () => {
      let faucetConfig = this.powClient.getFaucetConfig();
      this.setState({
        initializing: false,
        faucetConfig: faucetConfig,
        showRestoreSessionDialog: (this.state.miningStatus == PoWCaptchaMiningStatus.IDLE && !!this.powSession.getStoredSessionInfo()),
      });
    });

    this.powSession = new PoWSession({
      client: this.powClient,
      getInputs: () => {
        var capToken = this.state.captchaToken;
        if(this.hcapControl) {
          this.hcapControl.resetCaptcha();
          this.setState({ captchaToken: null, })
        }
        return {
          addr: this.state.targetAddr,
          token: capToken
        };
      },
    })

    this.state = {
      initializing: true,
      faucetConfig: null,
      targetAddr: "",
      requestCaptcha: false,
      captchaToken: null,
      miningStatus: PoWCaptchaMiningStatus.IDLE,
      isClaimable: false,
      statusDialog: null,
      statusMessage: null,
      showRestoreSessionDialog: false,
      showClaimRewardDialog: null,
		};
  }

  public componentDidMount() {
    if(!this.powSessionUpdateListener) {
      this.powSessionUpdateListener = () => {
        let sessionInfo = this.powSession.getSessionInfo();
        if(this.state.miningStatus === PoWCaptchaMiningStatus.IDLE && sessionInfo) {
          // start miner
          if(!this.powSession.getMiner()) {
            this.powSession.setMiner(new PoWMiner({
              session: this.powSession,
              workerSrc: this.props.minerSrc,
              powParams: this.state.faucetConfig.powParams,
              nonceCount: this.state.faucetConfig.powNonceCount,
            }));
          }
          this.setState({
            miningStatus: PoWCaptchaMiningStatus.RUNNING,
            targetAddr: sessionInfo.targetAddr,
            isClaimable: (sessionInfo.balance >= this.state.faucetConfig.minClaim),
            statusMessage: null,
          });
        }
        else if(this.state.miningStatus !== PoWCaptchaMiningStatus.IDLE && !sessionInfo) {
          if(this.powSession.getMiner()) {
            this.powSession.getMiner().stopMiner();
            this.powSession.setMiner(null);
          }
          this.setState({
            miningStatus: PoWCaptchaMiningStatus.IDLE,
            targetAddr: "",
            statusMessage: null,
          });
        }
        else if(this.state.isClaimable !== (sessionInfo.balance >= this.state.faucetConfig.minClaim)) {
          this.setState({
            isClaimable: (sessionInfo.balance >= this.state.faucetConfig.minClaim),
          });
        }
      };
      this.powSession.on("update", this.powSessionUpdateListener);
    }
    if(!this.powSessionKilledListener) {
      this.powSessionKilledListener = (reason: string) => {
        this.setState({
          statusDialog: {
            title: "Session killed!",
            body: (
              <div className='alert alert-danger'>Your session has been killed for bad behaviour ({reason}). Are you cheating?? :(</div>
            ),
            closeButton: {
              caption: "Close",
            }
          },
        });
      };
      this.powSession.on("killed", this.powSessionKilledListener);
    }
  }

  public componentWillUnmount() {
    if(this.powSessionUpdateListener) {
      this.powSession.off("update", this.powSessionUpdateListener);
      this.powSessionUpdateListener = null;
    }
    if(this.powSessionKilledListener) {
      this.powSession.off("killed", this.powSessionKilledListener);
      this.powSessionKilledListener = null;
    }
  }

	public render(): React.ReactElement<IPoWCaptchaProps> {
    let renderControl: React.ReactElement;
    if(this.state.initializing) {
      return (
        <div className="pow-captcha">
          <div className="loading-spinner">
            <img src="/images/spinner.gif" className="spinner" />
            <span className="spinner-text">Connecting...</span>
          </div>
        </div>
      );
    }

    let actionButtonControl: React.ReactElement;
    let enableCaptcha = !!this.state.faucetConfig.hcapSiteKey;
    let requestCaptcha = false;

    switch(this.state.miningStatus) {
      case PoWCaptchaMiningStatus.IDLE:
        requestCaptcha = enableCaptcha && this.state.faucetConfig.hcapSession;
      case PoWCaptchaMiningStatus.STARTING:
        actionButtonControl = (
          <button 
            className="btn btn-success start-action" 
            onClick={(evt) => this.onStartMiningClick()} 
            disabled={this.state.miningStatus == PoWCaptchaMiningStatus.STARTING}>
              {this.state.statusMessage ? this.state.statusMessage : "Start Mining"}
          </button>
        );
        break;
      case PoWCaptchaMiningStatus.RUNNING:
      case PoWCaptchaMiningStatus.INTERRUPTED:
      case PoWCaptchaMiningStatus.STOPPING:
        actionButtonControl = (
          <button 
            className="btn btn-danger stop-action" 
            onClick={(evt) => this.onStopMiningClick()} 
            disabled={this.state.miningStatus !== PoWCaptchaMiningStatus.RUNNING}>
              {this.state.statusMessage ? this.state.statusMessage : (this.state.isClaimable ? "Stop Mining & Claim Rewards" : "Stop Mining")}
          </button>
        );
        break;
    }

    return (
      <div>
        <h1 className="center">{this.state.faucetConfig.faucetTitle}</h1>
        <div className="pow-header center">
          <div className="pow-status-container">
            {this.powSession.getMiner() ? 
              <PoWMinerStatus powMiner={this.powSession.getMiner()} powSession={this.powSession} faucetConfig={this.state.faucetConfig} stopMinerFn={() => this.onStopMiningClick()} /> :
              <img src={this.state.faucetConfig.faucetImage} className="image" />
            }
          </div>
        </div>
        {this.state.showRestoreSessionDialog ? this.renderRestoreSessionDialog() : null}
        {this.state.showClaimRewardDialog ? this.renderClaimRewardDialog() : null}
        {this.state.statusDialog ? this.renderStatusDialog() : null}
        <div className="faucet-inputs">
          <input 
            className="form-control" 
            value={this.state.targetAddr} 
            placeholder="Please enter ETH address" 
            onChange={(evt) => this.setState({ targetAddr: evt.target.value })} 
            disabled={this.state.miningStatus !== PoWCaptchaMiningStatus.IDLE} 
          />
          {requestCaptcha ? 
            <div className='faucet-captcha'>
              <HCaptcha 
                sitekey={this.state.faucetConfig.hcapSiteKey} 
                onVerify={(token) => this.setState({ captchaToken: token })}
                ref={(cap) => this.hcapControl = cap} 
              />
            </div>
          : null}
          <div className="faucet-actions center">
            {actionButtonControl}  
          </div>
          {renderControl}
        </div>
      </div>
    );
	}

  private onStartMiningClick() {
    this.setState({
      miningStatus: PoWCaptchaMiningStatus.STARTING,
      statusMessage: "Starting mining..."
    });
    this.powSession.startSession().then(() => {
      this.powSession.setMiner(new PoWMiner({
        session: this.powSession,
        workerSrc: this.props.minerSrc,
        powParams: this.state.faucetConfig.powParams,
        nonceCount: this.state.faucetConfig.powNonceCount,
      }));
      this.setState({
        miningStatus: PoWCaptchaMiningStatus.RUNNING,
        isClaimable: false,
        statusMessage: null,
      });
    }, (err) => {
      this.setState({
        miningStatus: PoWCaptchaMiningStatus.IDLE,
        statusDialog: {
          title: "Could not start session.",
          body: (<div className='alert alert-danger'>{(err && err.message ? err.message : err)}</div>),
          closeButton: {
            caption: "Close",
          }
        }, 
        statusMessage: null,
      });
    });
  }

  private onStopMiningClick() {
    this.setState({
      miningStatus: PoWCaptchaMiningStatus.STOPPING,
      statusMessage: "Claiming rewards..."
    });
    this.powSession.getMiner().stopMiner();

    let sessionInfo = this.powSession.getSessionInfo();
    this.powSession.closeSession().then((claimToken) => {
      this.powSession.setMiner(null);

      if(claimToken) {
        this.setState({
          showClaimRewardDialog: {
            session: sessionInfo.sessionId,
            startTime: sessionInfo.startTime,
            target: sessionInfo.targetAddr,
            balance: sessionInfo.balance,
            token: claimToken
          }
        });
      }
      else {
        this.setState({
          miningStatus: PoWCaptchaMiningStatus.IDLE,
          statusMessage: null,
        });
      }
    });
  }

  private renderStatusDialog(): ReactElement {
    return (
      <Modal show centered onHide={() => {
        this.setState({
          statusDialog: null,
        });
      }}>
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            {this.state.statusDialog.title}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {this.state.statusDialog.body}
        </Modal.Body>
        <Modal.Footer>
          {this.state.statusDialog.applyButton ? 
            <Button onClick={() => {
              this.state.statusDialog.applyButton.applyFn();
              this.setState({
                statusDialog: null,
              });
            }}>{this.state.statusDialog.applyButton.caption}</Button>
          : null}
          {this.state.statusDialog.closeButton ? 
            <Button onClick={() => {
              this.setState({
                statusDialog: null,
              });
            }}>{this.state.statusDialog.closeButton.caption}</Button>
          : null}
        </Modal.Footer>
      </Modal>
    );
  }

  private renderRestoreSessionDialog(): ReactElement {
    let storedSessionInfo = this.powSession.getStoredSessionInfo();
    return (
      <Modal show centered size="lg" onHide={() => {
        this.setState({
          showRestoreSessionDialog: false,
        });
      }}>
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Continue mining on previous session?
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className='container'>
            <div className='row'>
              <div className='col'>
                Do you want to continue mining on your previous session?
              </div>
            </div>
            <div className='row'>
              <div className='col-3'>
                Address:
              </div>
              <div className='col'>
                {storedSessionInfo.targetAddr}
              </div>
            </div>
            <div className='row'>
              <div className='col-3'>
                Start Time:
              </div>
              <div className='col'>
                {renderDate(new Date(storedSessionInfo.startTime * 1000), true)}
              </div>
            </div>
            <div className='row'>
              <div className='col-3'>
                Balance:
              </div>
              <div className='col'>
                {Math.round(weiToEth(storedSessionInfo.balance) * 100) / 100} ETH
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => {
            this.setState({
              showRestoreSessionDialog: false,
            });
            this.powSession.restoreStoredSession();
          }}>Continue previous session</Button>
          <Button onClick={() => {
            this.setState({
              showRestoreSessionDialog: false,
            });
          }}>Start new session</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private renderClaimRewardDialog(): ReactElement {
    return (
      <PoWClaimDialog 
        powClient={this.powClient}
        powSession={this.powSession}
        reward={this.state.showClaimRewardDialog}
        faucetConfig={this.state.faucetConfig}
        onClose={() => {
          this.setState({
            showClaimRewardDialog: null,
            miningStatus: PoWCaptchaMiningStatus.IDLE,
            statusMessage: null,
          });
        }}
        setDialog={(dialog) => {
          this.setState({
            statusDialog: dialog
          });
        }} 
      />
    );
  }

}